import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";
import {
  isMetaMessageHtmlPath,
  isMetaMessageJsonPath
} from "./meta-parser.js";

/**
 * Reads only Meta Messenger JSON chunks from a ZIP-like Blob/File stream.
 * Media entries are deliberately not started, so they are not inflated into memory.
 * @param {{stream: () => ReadableStream}} file
 * @returns {Promise<{entries:Array<{name:string,text:string}>,sawHtml:boolean}>}
 */
export async function readMetaZip(file) {
  const decoder = new TextDecoder("utf-8");

  return new Promise(async (resolve, reject) => {
    const entries = [];
    let sawHtml = false;
    let pending = 0;
    let inputFinished = false;
    let settled = false;

    const finishIfReady = () => {
      if (!settled && inputFinished && pending === 0) {
        settled = true;
        resolve({ entries, sawHtml });
      }
    };

    const unzip = new Unzip(entry => {
      if (isMetaMessageHtmlPath(entry.name)) {
        sawHtml = true;
        return;
      }

      if (!isMetaMessageJsonPath(entry.name)) return;

      pending += 1;
      const chunks = [];
      let length = 0;

      entry.ondata = (error, chunk, final) => {
        if (settled) return;

        if (error) {
          settled = true;
          reject(error);
          return;
        }

        chunks.push(chunk);
        length += chunk.length;

        if (!final) return;

        const joined = new Uint8Array(length);
        let offset = 0;
        for (const part of chunks) {
          joined.set(part, offset);
          offset += part.length;
        }

        entries.push({
          name: entry.name,
          text: decoder.decode(joined)
        });

        pending -= 1;
        finishIfReady();
      };

      entry.start();
    });

    unzip.register(UnzipInflate);
    unzip.register(UnzipPassThrough);

    try {
      const reader = file.stream().getReader();

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          unzip.push(new Uint8Array(), true);
          inputFinished = true;
          finishIfReady();
          break;
        }

        unzip.push(value, false);
      }
    } catch (error) {
      if (!settled) {
        settled = true;
        reject(error);
      }
    }
  });
}
