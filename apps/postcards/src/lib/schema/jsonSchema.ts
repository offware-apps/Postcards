import { z } from "zod";
import { PostcardsFileSchema, SCHEMA_VERSION } from "./models";

/**
 * The published JSON Schema for the portable data file (Constitution VIII,
 * contracts/portable-data-file.md), generated from the Zod models so the two
 * can never drift. `io: "input"` publishes what a file must look like BEFORE
 * the app's sanitizing transforms run — that's the shape other tools and
 * people author. The committed artifact `portable-file.schema.json` is kept
 * in sync by tests/unit/schemaArtifact.spec.ts (`pnpm schema` regenerates it).
 */
export function portableFileJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(PostcardsFileSchema, {
    io: "input",
    target: "draft-2020-12",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  return {
    $id: `https://github.com/offware-apps/Postcards/blob/main/apps/postcards/src/lib/schema/portable-file.schema.json`,
    title: `Postcards portable data file (schemaVersion ${SCHEMA_VERSION})`,
    ...schema,
  };
}
