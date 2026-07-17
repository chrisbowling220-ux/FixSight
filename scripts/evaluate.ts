import { readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

type JsonObject = Record<string, unknown>;

type ImageReference =
  | string
  | {
      path: string;
      media_type?: string;
    };

type ExpectedValue = string | null;

interface Expectations {
  allowed_result_types?: string[];
  min_severity?: number;
  max_severity?: number;
  min_confidence?: number;
  max_confidence?: number;
  needs_professional?: boolean;
  professional_type?: ExpectedValue | ExpectedValue[];
  image_quality?: string | string[];
}

interface EvaluationCase {
  id?: string;
  name?: string;
  images: ImageReference[];
  category?: string;
  description?: string;
  expect: Expectations;
}

interface LoadedImage {
  data: string;
  media_type: string;
}

interface FieldLookup {
  found: boolean;
  value: unknown;
}

interface CaseResult {
  elapsedMs: number;
  failures: string[];
  response?: JsonObject;
}

const DEFAULT_CASES_PATH = "evaluation/cases.json";
const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_TIMEOUT_MS = 120_000;

const MEDIA_TYPES_BY_EXTENSION: Record<string, string> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const SUPPORTED_EXPECTATIONS = new Set([
  "allowed_result_types",
  "min_severity",
  "max_severity",
  "min_confidence",
  "max_confidence",
  "needs_professional",
  "professional_type",
  "image_quality",
]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  return JSON.stringify(value) ?? String(value);
}

function parseTimeout(): number {
  const configured = process.env.FIXSIGHT_TIMEOUT_MS;
  if (configured === undefined) return DEFAULT_TIMEOUT_MS;

  const timeout = Number(configured);
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new Error("FIXSIGHT_TIMEOUT_MS must be a positive integer.");
  }
  return timeout;
}

function validateStringArray(value: unknown, location: string): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === "string" && item.length > 0)
  ) {
    throw new Error(`${location} must be a non-empty array of strings.`);
  }
}

function validateBound(
  value: unknown,
  location: string,
  minimum: number,
  maximum: number,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${location} must be a number from ${minimum} through ${maximum}.`);
  }
}

function validateExpectations(value: unknown, location: string): asserts value is Expectations {
  if (!isObject(value)) throw new Error(`${location} must be an object.`);

  for (const key of Object.keys(value)) {
    if (!SUPPORTED_EXPECTATIONS.has(key)) {
      throw new Error(`${location}.${key} is not a supported expectation.`);
    }
  }

  if (hasOwn(value, "allowed_result_types")) {
    validateStringArray(value.allowed_result_types, `${location}.allowed_result_types`);
  }

  for (const key of ["min_severity", "max_severity"] as const) {
    if (hasOwn(value, key)) validateBound(value[key], `${location}.${key}`, 0, 10);
  }
  for (const key of ["min_confidence", "max_confidence"] as const) {
    if (hasOwn(value, key)) validateBound(value[key], `${location}.${key}`, 0, 1);
  }

  if (
    typeof value.min_severity === "number" &&
    typeof value.max_severity === "number" &&
    value.min_severity > value.max_severity
  ) {
    throw new Error(`${location}.min_severity cannot exceed max_severity.`);
  }
  if (
    typeof value.min_confidence === "number" &&
    typeof value.max_confidence === "number" &&
    value.min_confidence > value.max_confidence
  ) {
    throw new Error(`${location}.min_confidence cannot exceed max_confidence.`);
  }

  if (hasOwn(value, "needs_professional") && typeof value.needs_professional !== "boolean") {
    throw new Error(`${location}.needs_professional must be a boolean.`);
  }

  if (hasOwn(value, "professional_type")) {
    const allowed = Array.isArray(value.professional_type)
      ? value.professional_type
      : [value.professional_type];
    if (
      allowed.length === 0 ||
      !allowed.every((item) => item === null || (typeof item === "string" && item.length > 0))
    ) {
      throw new Error(
        `${location}.professional_type must be a string, null, or a non-empty array of strings/null.`,
      );
    }
  }

  if (hasOwn(value, "image_quality")) {
    const allowed = Array.isArray(value.image_quality) ? value.image_quality : [value.image_quality];
    if (
      allowed.length === 0 ||
      !allowed.every((item) => ["good", "usable", "poor"].includes(String(item)))
    ) {
      throw new Error(
        `${location}.image_quality must be good, usable, poor, or a non-empty array of those values.`,
      );
    }
  }
}

function validateImageReference(value: unknown, location: string): asserts value is ImageReference {
  if (typeof value === "string" && value.length > 0) return;
  if (!isObject(value) || typeof value.path !== "string" || value.path.length === 0) {
    throw new Error(`${location} must be a path string or an object containing a path.`);
  }
  if (hasOwn(value, "media_type") && typeof value.media_type !== "string") {
    throw new Error(`${location}.media_type must be a string.`);
  }
}

function validateCases(value: unknown): EvaluationCase[] {
  const cases = Array.isArray(value) ? value : isObject(value) ? value.cases : undefined;
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('The cases file must contain a non-empty "cases" array.');
  }

  cases.forEach((candidate, index) => {
    const location = `cases[${index}]`;
    if (!isObject(candidate)) throw new Error(`${location} must be an object.`);
    if (hasOwn(candidate, "id") && typeof candidate.id !== "string") {
      throw new Error(`${location}.id must be a string.`);
    }
    if (hasOwn(candidate, "name") && typeof candidate.name !== "string") {
      throw new Error(`${location}.name must be a string.`);
    }
    if (!Array.isArray(candidate.images) || candidate.images.length === 0) {
      throw new Error(`${location}.images must be a non-empty array.`);
    }
    candidate.images.forEach((image, imageIndex) =>
      validateImageReference(image, `${location}.images[${imageIndex}]`),
    );
    for (const key of ["category", "description"] as const) {
      if (hasOwn(candidate, key) && typeof candidate[key] !== "string") {
        throw new Error(`${location}.${key} must be a string.`);
      }
    }
    validateExpectations(candidate.expect, `${location}.expect`);
  });

  return cases as EvaluationCase[];
}

async function loadImage(reference: ImageReference, casesDirectory: string): Promise<LoadedImage> {
  const configuredPath = typeof reference === "string" ? reference : reference.path;
  const imagePath = isAbsolute(configuredPath)
    ? configuredPath
    : resolve(casesDirectory, configuredPath);
  const inferredMediaType = MEDIA_TYPES_BY_EXTENSION[extname(imagePath).toLowerCase()];
  const mediaType = typeof reference === "string" ? inferredMediaType : reference.media_type ?? inferredMediaType;

  if (!mediaType) {
    throw new Error(
      `Cannot infer the media type for ${configuredPath}; use { "path": "...", "media_type": "image/..." }.`,
    );
  }

  const bytes = await readFile(imagePath);
  if (bytes.length === 0) throw new Error(`Image is empty: ${configuredPath}`);
  return { data: bytes.toString("base64"), media_type: mediaType };
}

function responseCandidates(response: JsonObject): JsonObject[] {
  const candidates: JsonObject[] = [response];
  for (const key of ["analysis", "diagnosis", "result", "data"]) {
    const value = response[key];
    if (isObject(value)) candidates.push(value);
  }
  for (const candidate of [...candidates]) {
    if (isObject(candidate.diagnosis) && !candidates.includes(candidate.diagnosis)) {
      candidates.push(candidate.diagnosis);
    }
  }
  return candidates;
}

function findField(response: JsonObject, names: string[]): FieldLookup {
  for (const candidate of responseCandidates(response)) {
    for (const name of names) {
      if (hasOwn(candidate, name)) return { found: true, value: candidate[name] };
    }
  }
  return { found: false, value: undefined };
}

function checkAllowed(
  failures: string[],
  response: JsonObject,
  fieldNames: string[],
  expectationName: string,
  allowed: unknown[],
): void {
  const actual = findField(response, fieldNames);
  if (!actual.found) {
    failures.push(`missing ${fieldNames[0]} (required by ${expectationName})`);
    return;
  }
  if (!allowed.some((expected) => Object.is(expected, actual.value))) {
    failures.push(
      `${fieldNames[0]} was ${describe(actual.value)}; allowed values: ${allowed.map(describe).join(", ")}`,
    );
  }
}

function checkRange(
  failures: string[],
  response: JsonObject,
  fieldNames: string[],
  minimum: number | undefined,
  maximum: number | undefined,
): void {
  if (minimum === undefined && maximum === undefined) return;

  const actual = findField(response, fieldNames);
  if (!actual.found) {
    failures.push(`missing ${fieldNames[0]} (required by a configured range)`);
    return;
  }
  if (typeof actual.value !== "number" || !Number.isFinite(actual.value)) {
    failures.push(`${fieldNames[0]} must be numeric; received ${describe(actual.value)}`);
    return;
  }
  if (minimum !== undefined && actual.value < minimum) {
    failures.push(`${fieldNames[0]} ${actual.value} is below minimum ${minimum}`);
  }
  if (maximum !== undefined && actual.value > maximum) {
    failures.push(`${fieldNames[0]} ${actual.value} exceeds maximum ${maximum}`);
  }
}

function score(response: JsonObject, expected: Expectations): string[] {
  const failures: string[] = [];

  if (expected.allowed_result_types) {
    checkAllowed(
      failures,
      response,
      ["result_type"],
      "allowed_result_types",
      expected.allowed_result_types,
    );
  }
  checkRange(
    failures,
    response,
    ["severity", "severity_score"],
    expected.min_severity,
    expected.max_severity,
  );
  checkRange(
    failures,
    response,
    ["confidence"],
    expected.min_confidence,
    expected.max_confidence,
  );

  if (hasOwn(expected, "needs_professional")) {
    checkAllowed(
      failures,
      response,
      ["needs_professional"],
      "needs_professional",
      [expected.needs_professional],
    );
  }
  if (hasOwn(expected, "professional_type")) {
    const allowed = Array.isArray(expected.professional_type)
      ? expected.professional_type
      : [expected.professional_type];
    checkAllowed(failures, response, ["professional_type"], "professional_type", allowed);
  }
  if (hasOwn(expected, "image_quality")) {
    const allowed = Array.isArray(expected.image_quality)
      ? expected.image_quality
      : [expected.image_quality];
    checkAllowed(failures, response, ["image_quality"], "image_quality", allowed);
  }

  return failures;
}

function summary(response: JsonObject): string {
  const fields: Array<[string, string[]]> = [
    ["result_type", ["result_type"]],
    ["image_quality", ["image_quality"]],
    ["severity", ["severity", "severity_score"]],
    ["confidence", ["confidence"]],
    ["needs_professional", ["needs_professional"]],
    ["professional_type", ["professional_type"]],
  ];
  const parts = fields.flatMap(([label, names]) => {
    const field = findField(response, names);
    return field.found ? [`${label}=${describe(field.value)}`] : [];
  });
  return parts.length > 0 ? parts.join(" | ") : "no scored fields returned";
}

async function postCase(
  evaluationCase: EvaluationCase,
  casesDirectory: string,
  endpoint: string,
  timeoutMs: number,
): Promise<JsonObject> {
  const images = await Promise.all(
    evaluationCase.images.map((reference) => loadImage(reference, casesDirectory)),
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        images,
        category: evaluationCase.category,
        description: evaluationCase.description,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`request timed out after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const bodyText = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    const excerpt = bodyText.replace(/\s+/g, " ").slice(0, 240);
    throw new Error(`HTTP ${response.status} returned non-JSON${excerpt ? `: ${excerpt}` : "."}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  if (!isObject(body)) throw new Error("API response must be a JSON object.");
  return body;
}

async function runCase(
  evaluationCase: EvaluationCase,
  casesDirectory: string,
  endpoint: string,
  timeoutMs: number,
): Promise<CaseResult> {
  const started = Date.now();
  try {
    const response = await postCase(evaluationCase, casesDirectory, endpoint, timeoutMs);
    return {
      elapsedMs: Date.now() - started,
      failures: score(response, evaluationCase.expect),
      response,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { elapsedMs: Date.now() - started, failures: [message] };
  }
}

function caseLabel(evaluationCase: EvaluationCase, index: number): string {
  return evaluationCase.name ?? evaluationCase.id ?? `case-${index + 1}`;
}

function printUsage(): void {
  console.log(`Usage: tsx scripts/evaluate.ts [cases-file]

Defaults:
  cases-file             ${DEFAULT_CASES_PATH}
  FIXSIGHT_BASE_URL      ${DEFAULT_BASE_URL}
  FIXSIGHT_TIMEOUT_MS    ${DEFAULT_TIMEOUT_MS}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }
  if (args.length > 1) throw new Error("Expected zero or one cases-file argument. Use --help for usage.");

  const casesPath = resolve(process.cwd(), args[0] ?? DEFAULT_CASES_PATH);
  const casesDirectory = resolve(casesPath, "..");
  const baseUrl = (process.env.FIXSIGHT_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const endpoint = `${baseUrl}/api/analyze`;
  new URL(endpoint);
  const timeoutMs = parseTimeout();

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(casesPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read cases file ${casesPath}: ${message}`);
  }
  const cases = validateCases(parsed);

  console.log("FixSight Phase 0 evaluation");
  console.log(`Cases:    ${relative(process.cwd(), casesPath) || casesPath}`);
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Count:    ${cases.length}\n`);

  let passed = 0;
  for (let index = 0; index < cases.length; index += 1) {
    const evaluationCase = cases[index]!;
    const result = await runCase(evaluationCase, casesDirectory, endpoint, timeoutMs);
    const succeeded = result.failures.length === 0;
    if (succeeded) passed += 1;

    console.log(
      `[${index + 1}/${cases.length}] ${succeeded ? "PASS" : "FAIL"} ${caseLabel(evaluationCase, index)} (${result.elapsedMs} ms)`,
    );
    if (result.response) console.log(`  ${summary(result.response)}`);
    for (const failure of result.failures) console.log(`  - ${failure}`);
  }

  const failed = cases.length - passed;
  console.log(`\nSummary: ${passed} passed, ${failed} failed, ${cases.length} total`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Evaluation error: ${message}`);
  process.exitCode = 1;
});
