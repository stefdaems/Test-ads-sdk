#!/usr/bin/env ts-node
/**
 * TV Labs Build Uploader
 *
 * Uploads an app artifact (APK / IPA / ZIP) to TV Labs via the Phoenix
 * WebSocket build channel (`wss://tvlabs.ai/cli/websocket`).
 *
 * On success the build_id is written to stdout so that the caller
 * (install-apps.ts) can capture it and pass it to the test runner as
 * the TVLABS_BUILD_ID environment variable.
 *
 * Usage:
 *   ts-node scripts/tvlabs-upload.ts --artifact <path/to/app.apk> [--slug <app-slug>]
 *
 * Environment variables:
 *   TVLABS_API_KEY  - TV Labs API key (from https://tvlabs.ai/app/keys)
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TVLABS_CLI_WS = 'wss://tvlabs.ai/cli/websocket';
const PHOENIX_VSN   = '2.0.0';
const TOPIC         = 'upload:lobby';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A Phoenix channel message encoded as a 5-element JSON array. */
type PhxMessage = [string | null, string | null, string, string, Record<string, unknown>];

interface FileMetadata {
  filename: string;
  sha256:   string;
  size:     number;
  mimeType: string;
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function sha256File(filePath: string): string {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function getMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.apk': return 'application/vnd.android.package-archive';
    case '.zip': return 'application/zip';
    default:     return 'application/octet-stream'; // .ipa and others
  }
}

function getFileMetadata(filePath: string): FileMetadata {
  const stats = fs.statSync(filePath);
  return {
    filename: path.basename(filePath),
    sha256:   sha256File(filePath),
    size:     stats.size,
    mimeType: getMimeType(filePath),
  };
}

// ---------------------------------------------------------------------------
// HTTP PUT helper
// ---------------------------------------------------------------------------

async function putFile(presignedUrl: string, filePath: string, mimeType: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const fileBuffer = fs.readFileSync(filePath);
    const urlObj = new URL(presignedUrl);

    const req = https.request(
      {
        hostname: urlObj.hostname,
        path:     urlObj.pathname + urlObj.search,
        method:   'PUT',
        headers: {
          'Content-Type':   mimeType,
          'Content-Length': fileBuffer.length,
        },
      },
      (res) => {
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`PUT to presigned URL failed — HTTP ${res.statusCode}`));
        } else {
          resolve();
        }
        res.resume();
      },
    );

    req.on('error', reject);
    req.write(fileBuffer);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Minimal Phoenix channel client
// ---------------------------------------------------------------------------

async function phoenixUpload(
  apiKey:    string,
  filePath:  string,
  appSlug?:  string,
): Promise<string> {
  const wsUrl = `${TVLABS_CLI_WS}?api_key=${encodeURIComponent(apiKey)}&vsn=${PHOENIX_VSN}`;
  const ws    = new WebSocket(wsUrl);
  let refSeq  = 0;

  return new Promise<string>((resolve, reject) => {
    const pendingReplies = new Map<
      string,
      (payload: Record<string, unknown>) => void
    >();

    /**
     * Send a Phoenix channel push and return a Promise that resolves with
     * the `response` field of the server's `phx_reply`.
     */
    function push(
      topic:   string,
      event:   string,
      payload: Record<string, unknown>,
      joinRef: string | null = null,
    ): Promise<Record<string, unknown>> {
      return new Promise<Record<string, unknown>>((res, rej) => {
        const ref = String(++refSeq);
        const msg: PhxMessage = [joinRef, ref, topic, event, payload];

        pendingReplies.set(ref, (replyPayload) => {
          const typed = replyPayload as { status?: string; response?: Record<string, unknown> };
          if (typed.status === 'error') {
            rej(new Error(`Phoenix error: ${JSON.stringify(typed.response)}`));
          } else {
            res(typed.response ?? {});
          }
        });

        ws.send(JSON.stringify(msg));
      });
    }

    ws.on('open', async () => {
      try {
        const joinRef = String(++refSeq);

        // 1. Join the upload channel
        await push(TOPIC, 'phx_join', {}, joinRef);

        // 2. Request a presigned upload URL
        const meta = getFileMetadata(filePath);
        const uploadPayload: Record<string, unknown> = {
          filename:     meta.filename,
          sha256:       meta.sha256,
          size:         meta.size,
          content_type: meta.mimeType,
        };
        if (appSlug) uploadPayload.application_slug = appSlug;

        const uploadResp = await push(TOPIC, 'request_upload_url', uploadPayload, joinRef) as {
          url?:      string;
          build_id?: string;
          existing?: boolean;
        };

        const { url, build_id, existing } = uploadResp;
        if (!build_id) {
          throw new Error(`TV Labs did not return a build_id: ${JSON.stringify(uploadResp)}`);
        }

        if (!existing && url) {
          // 3. Upload the file to the presigned S3 URL
          const sizeMb = (meta.size / 1024 / 1024).toFixed(1);
          console.error(`  Uploading ${meta.filename} (${sizeMb} MB)…`);
          await putFile(url, filePath, meta.mimeType);

          // 4. Ask TV Labs to extract build metadata server-side
          await push(TOPIC, 'extract_build_info', {}, joinRef);
          console.error(`  Build info extracted.`);
        } else {
          console.error(`  Artifact already exists on TV Labs (build_id: ${build_id}).`);
        }

        ws.close();
        resolve(build_id);
      } catch (err) {
        ws.close();
        reject(err);
      }
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString()) as PhxMessage;
        const [, ref, , event, payload] = msg;

        if (event === 'phx_reply' && ref) {
          const handler = pendingReplies.get(ref);
          if (handler) {
            pendingReplies.delete(ref);
            handler(payload);
          }
        }
      } catch {
        // ignore malformed frames
      }
    });

    ws.on('error', (err) => reject(err));
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args        = process.argv.slice(2);
  const artifactIdx = args.indexOf('--artifact');
  const slugIdx     = args.indexOf('--slug');

  if (artifactIdx === -1) {
    console.error(
      'Usage: ts-node scripts/tvlabs-upload.ts --artifact <path> [--slug <app-slug>]',
    );
    process.exit(1);
  }

  const artifactPath = path.resolve(args[artifactIdx + 1]);
  const appSlug      = slugIdx !== -1 ? args[slugIdx + 1] : undefined;

  const apiKey = process.env.TVLABS_API_KEY;
  if (!apiKey) {
    console.error('❌ TVLABS_API_KEY is not set. Get your key at https://tvlabs.ai/app/keys');
    process.exit(1);
  }

  if (!fs.existsSync(artifactPath)) {
    console.error(`❌ Artifact not found: ${artifactPath}`);
    process.exit(1);
  }

  console.error(`\n☁ Uploading to TV Labs: ${artifactPath}`);
  const buildId = await phoenixUpload(apiKey, artifactPath, appSlug);

  console.error(`✅ TV Labs build_id: ${buildId}`);
  console.error(`   Sessions: https://tvlabs.ai/app/sessions`);

  // Write build_id to stdout only so install-apps.ts can capture it cleanly.
  process.stdout.write(buildId);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`❌ TV Labs upload failed: ${msg}`);
  process.exit(1);
});
