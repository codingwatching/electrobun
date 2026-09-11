import type {
  TestDefinition,
  WindowRenderer,
} from "./types";

export function getTestSkipReason(
  test: TestDefinition,
  availableRenderers: readonly WindowRenderer[],
): string | undefined {
  const requiredRenderer = test.requires?.renderer;
  if (!requiredRenderer || availableRenderers.includes(requiredRenderer)) {
    return undefined;
  }

  return `requires the ${requiredRenderer.toUpperCase()} renderer, but this build only includes ${availableRenderers.join(", ") || "no renderers"}`;
}
