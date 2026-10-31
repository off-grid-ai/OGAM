/**
 * Searching Hugging Face for an sd.cpp checkpoint offers only weights the phone can load.
 *
 * SPEC (OGAM user's view): a result can be downloaded and then used. A pack is read from the top of
 * its folder, so a checkpoint inside a sub-folder of a repository is not offered (it would download
 * in full and then not be found). A root-level checkpoint is offered with its plain file URL.
 *
 * The real search (huggingFaceModelBrowser.searchSDImageModels) runs; Hugging Face is faked at
 * `fetch` with its own API shapes, and each weight answers the 0-N byte Range probe with a real
 * safetensors header that names the SD model, VAE and text-encoder tensors.
 */
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';

const REPO = 'acme/photo-xl';
const SHA = 'a'.repeat(40);

/** A safetensors header: 8-byte little-endian length, then JSON naming the tensors. */
function checkpointHeader(): ArrayBuffer {
  const json = JSON.stringify({
    'model.diffusion_model.input_blocks.0.0.weight': { dtype: 'F16', shape: [1], data_offsets: [0, 2] },
    'first_stage_model.decoder.conv_in.weight': { dtype: 'F16', shape: [1], data_offsets: [2, 4] },
    'conditioner.embedders.0.transformer.text_model.embeddings.position_ids': { dtype: 'I64', shape: [1], data_offsets: [4, 12] },
  });
  const body = new TextEncoder().encode(json);
  const bytes = new Uint8Array(8 + body.length);
  new DataView(bytes.buffer).setUint32(0, body.length, true);
  bytes.set(body, 8);
  return bytes.buffer;
}

it('offers a root-level checkpoint with its plain URL, and not one in a sub-folder', async () => {
  installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const probed: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/api/models') return json([{ id: REPO }]);
    if (url.pathname === `/api/models/${REPO}`) {
      return json({
        sha: SHA,
        siblings: [
          { rfilename: 'photo-xl.safetensors', size: 6.9 * GB },
          { rfilename: 'unet/photo-xl.safetensors', size: 6.9 * GB },
        ],
      });
    }
    if (url.pathname.startsWith(`/${REPO}/resolve/${SHA}/`)) {
      probed.push(url.pathname);
      const header = checkpointHeader();
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      if (!range) return new Response(header, { status: 200 });
      return new Response(header, {
        status: 206,
        headers: { 'content-range': `bytes 0-${header.byteLength - 1}/${6.9 * GB}`, 'content-length': String(header.byteLength) },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  try {
    const { searchSDImageModels } = require('../../../src/services/huggingFaceModelBrowser');
    const results = await searchSDImageModels('photo xl');
    expect(results.map((model: { fileName: string }) => model.fileName)).toEqual(['photo-xl.safetensors']);
    expect(results[0].downloadUrl).toBe(`https://huggingface.co/${REPO}/resolve/${SHA}/photo-xl.safetensors`);
    // The sub-folder weight is not even probed.
    expect(probed).toEqual([`/${REPO}/resolve/${SHA}/photo-xl.safetensors`]);
  } finally {
    globalThis.fetch = original;
  }
});
