import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { type ZodType, z } from "zod";
import {
  CONFIG_FORMAT,
  configSchema,
  credentialsSchema,
  spendSchema,
} from "../src/config.ts";
import { FORMAT } from "../src/front-matter.ts";
import { personaSchema } from "../src/persona.ts";
import { metaSchema } from "../src/ranking-file.ts";
import { manifestSchema, SNAPSHOT_FORMAT } from "../src/snapshot.ts";
import { workspaceSchema } from "../src/workspace.ts";

/**
 * The shape of every file each format version describes, as a hash of the
 * schemas' JSON Schema. A schema change fails here until its version is bumped
 * and the new version's hash is added. Released entries are never edited:
 * a file written by that version must still be recognised by its number.
 */
const RECORDED = {
  FORMAT: {
    1: "4e1b3866dac3e949d0a82b3dc5f23cce9d33c46ce4475f121b19c440fa75d517",
  } as Record<number, string>,
  SNAPSHOT_FORMAT: {
    1: "12433ddcbaaed4fcea883fea30927bac312c0ec35c823167a93c480e8e79fd42",
  } as Record<number, string>,
  CONFIG_FORMAT: {
    1: "e6305a6713f98408246fac7c27de221ca0981472028e8b62ae492129951b3650",
  } as Record<number, string>,
};

function shapeHash(...schemas: ZodType[]): string {
  const json = JSON.stringify(schemas.map((s) => z.toJSONSchema(s)));
  return createHash("sha256").update(json).digest("hex");
}

test.each([
  ["FORMAT", FORMAT, shapeHash(metaSchema, workspaceSchema, personaSchema)],
  ["SNAPSHOT_FORMAT", SNAPSHOT_FORMAT, shapeHash(manifestSchema)],
  [
    "CONFIG_FORMAT",
    CONFIG_FORMAT,
    shapeHash(configSchema, credentialsSchema, spendSchema),
  ],
] as const)(
  "%s %i matches the file shape recorded for it",
  (name, version, hash) => {
    expect(
      RECORDED[name][version],
      `the files ${name} ${version} describes changed shape: bump ${name} and record its hash`,
    ).toBe(hash);
  },
);
