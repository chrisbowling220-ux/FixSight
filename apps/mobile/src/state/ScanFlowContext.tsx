import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { analyzeScan } from "../lib/api";
import { saveHistory, type HistoryRecord } from "../lib/history";
import type { Analysis, AnalyzeRequest, ScanAnswer } from "../lib/contract";
import type { SelectedImage } from "../lib/images";

type FlowPhase = "idle" | "queued" | "analyzing" | "complete" | "error";

interface ScanFlowValue {
  images: SelectedImage[];
  category: string;
  description: string;
  analysis: Analysis | null;
  phase: FlowPhase;
  error: string | null;
  parentScanId: string | null;
  savedScanId: string | null;
  setCategory: (value: string) => void;
  setDescription: (value: string) => void;
  addImages: (images: SelectedImage[]) => void;
  removeImage: (id: string) => void;
  queueAnalysis: (answers?: ScanAnswer[]) => void;
  runQueuedAnalysis: () => Promise<Analysis>;
  resetScan: () => void;
  startReinspection: (record: HistoryRecord) => void;
}

const ScanFlowContext = createContext<ScanFlowValue | null>(null);

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function ScanFlowProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const mutation = useMutation({ mutationFn: (request: AnalyzeRequest) => analyzeScan(request) });
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [answers, setAnswers] = useState<ScanAnswer[]>([]);
  const [phase, setPhase] = useState<FlowPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [parentScanId, setParentScanId] = useState<string | null>(null);
  const [savedScanId, setSavedScanId] = useState<string | null>(null);
  const flightRef = useRef<Promise<Analysis> | null>(null);

  const addImages = useCallback((incoming: SelectedImage[]) => {
    setImages((current) => [...current, ...incoming].slice(0, 4));
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((current) => current.filter((image) => image.id !== id));
  }, []);

  const queueAnalysis = useCallback((nextAnswers: ScanAnswer[] = []) => {
    setAnswers(nextAnswers);
    setError(null);
    setAnalysis(null);
    setSavedScanId(null);
    mutation.reset();
    setPhase("queued");
  }, [mutation]);

  const runQueuedAnalysis = useCallback((): Promise<Analysis> => {
    if (flightRef.current) return flightRef.current;
    if (phase !== "queued") {
      return Promise.reject(new Error("No scan is ready to analyze."));
    }
    if (images.length === 0) {
      return Promise.reject(new Error("Add at least one photo before analyzing."));
    }

    const request: AnalyzeRequest = {
      images: images.map((image) => ({ data: image.data, media_type: image.mediaType })),
      answers,
      ...(category.trim() ? { category: category.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
    };

    // eslint-disable-next-line prefer-const
    let task!: Promise<Analysis>;
    task = (async () => {
      setPhase("analyzing");
      try {
        const response = await mutation.mutateAsync(request);
        setAnalysis(response.analysis);
        setPhase("complete");

        if (response.analysis.result_type === "diagnosis") {
          const firstImage = images[0];
          if (firstImage) {
            try {
              const saved = await saveHistory({
                serverScanId: response.scanId,
                parentScanId,
                imageUri: firstImage.uri,
                imageMediaType: firstImage.mediaType,
                category: category.trim() || null,
                analysis: response.analysis,
              });
              setSavedScanId(saved.id);
              await queryClient.invalidateQueries({ queryKey: ["history"] });
            } catch {
              // A local history failure must not hide a valid safety result.
            }
          }
        }
        return response.analysis;
      } catch (cause) {
        setError(messageFor(cause));
        setPhase("error");
        throw cause;
      } finally {
        if (flightRef.current === task) flightRef.current = null;
      }
    })();
    flightRef.current = task;
    return task;
  }, [answers, category, description, images, mutation, parentScanId, phase, queryClient]);

  const resetScan = useCallback(() => {
    setImages([]);
    setCategory("");
    setDescription("");
    setAnalysis(null);
    setAnswers([]);
    setError(null);
    setParentScanId(null);
    setSavedScanId(null);
    mutation.reset();
    setPhase("idle");
  }, [mutation]);

  const startReinspection = useCallback((record: HistoryRecord) => {
    setImages([]);
    setCategory(record.category ?? "");
    setDescription("Reinspection of a previous FixSight scan.");
    setAnalysis(null);
    setAnswers([]);
    setError(null);
    setParentScanId(record.id);
    setSavedScanId(null);
    mutation.reset();
    setPhase("idle");
  }, [mutation]);

  const value = useMemo<ScanFlowValue>(() => ({
    images,
    category,
    description,
    analysis,
    phase,
    error,
    parentScanId,
    savedScanId,
    setCategory,
    setDescription,
    addImages,
    removeImage,
    queueAnalysis,
    runQueuedAnalysis,
    resetScan,
    startReinspection,
  }), [
    images, category, description, analysis, phase, error, parentScanId, savedScanId,
    addImages, removeImage, queueAnalysis, runQueuedAnalysis, resetScan, startReinspection,
  ]);

  return <ScanFlowContext.Provider value={value}>{children}</ScanFlowContext.Provider>;
}

export function useScanFlow(): ScanFlowValue {
  const context = useContext(ScanFlowContext);
  if (!context) throw new Error("useScanFlow must be used inside ScanFlowProvider.");
  return context;
}
