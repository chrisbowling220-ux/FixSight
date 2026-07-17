import { useCallback, useRef, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useRouter } from "expo-router";
import { fromCameraPicture, fromPickerAsset } from "../../src/lib/images";
import { useScanFlow } from "../../src/state/ScanFlowContext";
import { colors, radius, shadow } from "../../src/theme";

const CATEGORIES = [
  "Windows & Doors",
  "Ceiling & Walls",
  "Flooring",
  "Exterior",
  "Plumbing",
  "Electrical",
];

export default function CaptureScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [taking, setTaking] = useState(false);

  const {
    images,
    category,
    description,
    phase,
    addImages,
    removeImage,
    setCategory,
    setDescription,
    queueAnalysis,
    resetScan,
  } = useScanFlow();

  // Reset on focus if in error state so user can retry cleanly
  useFocusEffect(
    useCallback(() => {
      if (phase === "error") {
        resetScan();
      }
    }, [phase, resetScan]),
  );

  async function handleTakePhoto() {
    if (!cameraRef.current || !cameraReady || taking) return;
    if (images.length >= 4) {
      Alert.alert("Maximum photos", "You can add up to 4 photos per scan.");
      return;
    }
    try {
      setTaking(true);
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.85,
      });
      if (photo) {
        addImages([fromCameraPicture(photo)]);
      }
    } catch (err) {
      Alert.alert(
        "Camera error",
        err instanceof Error ? err.message : "Could not take photo. Try again.",
      );
    } finally {
      setTaking(false);
    }
  }

  async function handlePickFromLibrary() {
    if (images.length >= 4) {
      Alert.alert("Maximum photos", "You can add up to 4 photos per scan.");
      return;
    }
    const remaining = 4 - images.length;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsMultipleSelection: true,
      base64: true,
      quality: 0.85,
      selectionLimit: remaining,
    });
    if (result.canceled) return;
    try {
      const selected = result.assets.map(fromPickerAsset);
      addImages(selected);
    } catch (err) {
      Alert.alert(
        "Photo error",
        err instanceof Error ? err.message : "Could not read the selected photo.",
      );
    }
  }

  function handleAnalyze() {
    if (images.length === 0) return;
    queueAnalysis();
    router.push("/analyzing");
  }

  // Camera permission not yet determined
  if (!permission) {
    return <View style={styles.permissionContainer} />;
  }

  // Camera permission denied
  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionTitle}>Camera access needed</Text>
        <Text style={styles.permissionBody}>
          FixSight needs camera access to photograph problem areas. You can also
          choose photos from your library.
        </Text>
        <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
          <Text style={styles.permissionBtnText}>Grant camera access</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.permissionBtn, styles.secondaryBtn]}
          onPress={handlePickFromLibrary}
        >
          <Text style={[styles.permissionBtnText, styles.secondaryBtnText]}>
            Choose from library
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Camera viewfinder */}
      <View style={styles.cameraContainer}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="back"
          onCameraReady={() => setCameraReady(true)}
        />
        {/* Capture button overlay */}
        <View style={styles.captureRow}>
          <TouchableOpacity
            style={styles.libraryBtn}
            onPress={handlePickFromLibrary}
            activeOpacity={0.8}
          >
            <Text style={styles.libraryBtnText}>Library</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.shutterBtn, (taking || !cameraReady) && styles.shutterBtnDisabled]}
            onPress={handleTakePhoto}
            activeOpacity={0.8}
            disabled={taking || !cameraReady}
          >
            <View style={styles.shutterInner} />
          </TouchableOpacity>
          <View style={styles.shutterSpacer} />
        </View>
      </View>

      {/* Controls below camera */}
      <ScrollView
        style={styles.controls}
        contentContainerStyle={styles.controlsContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Image thumbnails */}
        {images.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.thumbsRow}
            contentContainerStyle={styles.thumbsContent}
          >
            {images.map((img) => (
              <View key={img.id} style={styles.thumbWrapper}>
                <Image source={{ uri: img.uri }} style={styles.thumb} />
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => removeImage(img.id)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Text style={styles.removeBtnText}>×</Text>
                </TouchableOpacity>
              </View>
            ))}
            {images.length < 4 && (
              <TouchableOpacity
                style={styles.addMoreBtn}
                onPress={handlePickFromLibrary}
                activeOpacity={0.7}
              >
                <Text style={styles.addMorePlus}>+</Text>
                <Text style={styles.addMoreLabel}>Add</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}

        {/* Category chips */}
        <Text style={styles.sectionLabel}>Category (optional)</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsRow}
          contentContainerStyle={styles.chipsContent}
        >
          {CATEGORIES.map((cat) => {
            const selected = category === cat;
            return (
              <Pressable
                key={cat}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => setCategory(selected ? "" : cat)}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {cat}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Description */}
        <Text style={styles.sectionLabel}>Description (optional)</Text>
        <TextInput
          style={styles.descInput}
          value={description}
          onChangeText={setDescription}
          placeholder="Describe what you see or what concerns you…"
          placeholderTextColor={colors.muted}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          returnKeyType="done"
          blurOnSubmit
        />

        {/* Analyze button */}
        <TouchableOpacity
          style={[styles.analyzeBtn, images.length === 0 && styles.analyzeBtnDisabled]}
          onPress={handleAnalyze}
          activeOpacity={0.85}
          disabled={images.length === 0}
        >
          <Text style={styles.analyzeBtnText}>
            {images.length === 0 ? "Take or choose a photo to start" : "Analyze"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  // Permission screen
  permissionContainer: {
    flex: 1,
    backgroundColor: colors.canvas,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.ink,
    marginBottom: 12,
    textAlign: "center",
  },
  permissionBody: {
    fontSize: 15,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
  },
  permissionBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: radius.medium,
    marginBottom: 12,
    width: "100%",
    alignItems: "center",
  },
  permissionBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryBtn: {
    backgroundColor: colors.brandSoft,
  },
  secondaryBtnText: {
    color: colors.brand,
  },
  // Camera
  cameraContainer: {
    flex: 1,
    minHeight: 260,
    maxHeight: 340,
    position: "relative",
  },
  camera: {
    flex: 1,
  },
  captureRow: {
    position: "absolute",
    bottom: 16,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 32,
  },
  libraryBtn: {
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.small,
    width: 80,
    alignItems: "center",
  },
  libraryBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  shutterBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "rgba(255,255,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#fff",
  },
  shutterBtnDisabled: {
    opacity: 0.5,
  },
  shutterInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#fff",
  },
  shutterSpacer: {
    width: 80,
  },
  // Controls panel
  controls: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  controlsContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  // Thumbnails
  thumbsRow: {
    flexGrow: 0,
  },
  thumbsContent: {
    gap: 10,
    paddingVertical: 4,
  },
  thumbWrapper: {
    position: "relative",
    width: 72,
    height: 72,
    borderRadius: radius.small,
    overflow: "visible",
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: radius.small,
    backgroundColor: colors.line,
  },
  removeBtn: {
    position: "absolute",
    top: -8,
    right: -8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  removeBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 20,
    textAlign: "center",
  },
  addMoreBtn: {
    width: 72,
    height: 72,
    borderRadius: radius.small,
    borderWidth: 2,
    borderColor: colors.line,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  addMorePlus: {
    fontSize: 24,
    color: colors.muted,
    fontWeight: "300",
    lineHeight: 28,
  },
  addMoreLabel: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  // Section label
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 4,
  },
  // Category chips
  chipsRow: {
    flexGrow: 0,
  },
  chipsContent: {
    gap: 8,
    paddingVertical: 4,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.line,
    ...shadow,
    shadowOpacity: 0.04,
    elevation: 1,
  },
  chipSelected: {
    backgroundColor: colors.brandSoft,
    borderColor: colors.brand,
  },
  chipText: {
    fontSize: 14,
    color: colors.muted,
    fontWeight: "500",
  },
  chipTextSelected: {
    color: colors.brand,
    fontWeight: "700",
  },
  // Description
  descInput: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.medium,
    padding: 14,
    fontSize: 15,
    color: colors.ink,
    minHeight: 84,
    lineHeight: 22,
    ...shadow,
    shadowOpacity: 0.04,
    elevation: 1,
  },
  // Analyze button
  analyzeBtn: {
    backgroundColor: colors.brand,
    paddingVertical: 16,
    borderRadius: radius.medium,
    alignItems: "center",
    marginTop: 8,
    ...shadow,
  },
  analyzeBtnDisabled: {
    backgroundColor: colors.line,
    shadowOpacity: 0,
    elevation: 0,
  },
  analyzeBtnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
