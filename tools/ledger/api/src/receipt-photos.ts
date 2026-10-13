/**
 * Where receipt photos are kept (lg-8): on the data volume, beside the books,
 * at `<data>/receipts/<household>/<photo>`, one directory per household as the
 * books are one file per household (lg-21).
 *
 * **No part of the path comes from a request.** The household is the one the
 * identity check attached; the name is made here, a random UUID and the
 * extension of the type the photo's own bytes were read as; and the path built
 * from both is checked to sit directly in its household's directory all the
 * same, as `householdBooksPath` checks a books file. A photo is never logged:
 * nothing here writes a log line, and nothing that does is handed the bytes.
 *
 * Under `:memory:` the photos are kept in the process, as the books are.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@ledger/contract";
import type { ReceiptMediaType } from "@ledger/contract";
import { API_DEFAULTS } from "./config.ts";
import { isHouseholdId } from "./directory.ts";

export interface PhotoStore {
  /** Keeps the photo and returns the name it was kept under. */
  save(household: string, bytes: Uint8Array, mediaType: ReceiptMediaType): Promise<string>;
  load(household: string, photo: string): Promise<Uint8Array>;
  /** Undoes a `save` whose receipt was never recorded. */
  discard(household: string, photo: string): Promise<void>;
}

const EXTENSIONS: Record<ReceiptMediaType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** What `save` makes: a UUID and one of the three extensions, and nothing else. */
const PHOTO_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/u;

function photoName(mediaType: ReceiptMediaType): string {
  return `${randomUUID()}.${EXTENSIONS[mediaType]}`;
}

/** The file a household's photo is in, refused if it would be anywhere else. */
export function receiptPhotoPath(dataDir: string, household: string, photo: string): string {
  const directory = path.resolve(dataDir, API_DEFAULTS.receiptsDir, household);
  const file = path.resolve(directory, photo);
  if (!isHouseholdId(household) || !PHOTO_NAME.test(photo) || path.dirname(file) !== directory) {
    throw new AppError(
      "INTERNAL",
      "A receipt photo is named by this service, inside its household.",
    );
  }
  return file;
}

/** The photos as files on the data volume. */
export function filePhotoStore(dataDir: string): PhotoStore {
  return {
    async save(household, bytes, mediaType) {
      const photo = photoName(mediaType);
      const file = receiptPhotoPath(dataDir, household, photo);
      await mkdir(path.dirname(file), { recursive: true });
      // Written aside and renamed, so a photo is either whole or not there.
      const partial = `${file}.part`;
      await writeFile(partial, bytes, { flag: "wx" });
      await rename(partial, file);
      return photo;
    },
    async load(household, photo) {
      return await readFile(receiptPhotoPath(dataDir, household, photo));
    },
    async discard(household, photo) {
      await rm(receiptPhotoPath(dataDir, household, photo), { force: true });
    },
  };
}

/** The photos in the process, for `:memory:` books: gone with it, as they are. */
export function memoryPhotoStore(): PhotoStore {
  const held = new Map<string, Uint8Array>();
  const key = (household: string, photo: string): string => {
    receiptPhotoPath("/", household, photo);
    return `${household}/${photo}`;
  };
  return {
    async save(household, bytes, mediaType) {
      const photo = photoName(mediaType);
      held.set(key(household, photo), Uint8Array.from(bytes));
      return photo;
    },
    async load(household, photo) {
      const bytes = held.get(key(household, photo));
      if (bytes === undefined)
        throw new AppError("INTERNAL", "A recorded receipt's photo is gone.");
      return bytes;
    },
    async discard(household, photo) {
      held.delete(key(household, photo));
    },
  };
}
