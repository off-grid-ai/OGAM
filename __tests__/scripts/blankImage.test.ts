/**
 * The image engine's blank-frame check (native/video/common/BlankImage.hpp).
 *
 * SPEC: a diffusion graph whose latents go non-finite still decodes, and every pixel saturates to one
 * colour. On iPhone, ggml's Metal GroupNorm normalized only the first image of sd.cpp's batched CFG pass,
 * and every picture came back pure white (2026-11-02). The runtime counts a one-colour frame as a failed
 * run, so it falls back to the next device or reports an error; it never saves a blank picture.
 *
 * The real header compiles with the host C++ compiler and runs on real pixel buffers.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const HEADER_DIR = path.join(__dirname, '../../native/video/common');

const DRIVER = `
#include "BlankImage.hpp"
#include <cstdio>
#include <vector>
int main() {
  const uint32_t w = 64, h = 64, c = 3;
  std::vector<uint8_t> white(w * h * c, 255);
  std::vector<uint8_t> grey(w * h * c, 128);
  std::vector<uint8_t> gradient(w * h * c);
  for (size_t i = 0; i < gradient.size(); i++) gradient[i] = uint8_t(i / c % 251);
  std::vector<uint8_t> onePixel = white; onePixel[(w * h - 1) * c + 2] = 254;
  std::vector<uint8_t> rgba(w * h * 4, 255);
  std::printf("white=%d grey=%d gradient=%d onePixel=%d rgbaWhite=%d null=%d\\n",
    offgrid::isBlankImage(white.data(), w, h, c), offgrid::isBlankImage(grey.data(), w, h, c),
    offgrid::isBlankImage(gradient.data(), w, h, c), offgrid::isBlankImage(onePixel.data(), w, h, c),
    offgrid::isBlankImage(rgba.data(), w, h, 4), offgrid::isBlankImage(nullptr, w, h, c));
}
`;

it('counts a one-colour frame as blank and any real picture as an image', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-image-'));
  const source = path.join(dir, 'driver.cpp');
  const binary = path.join(dir, 'driver');
  fs.writeFileSync(source, DRIVER);
  execFileSync('c++', ['-std=c++17', '-I', HEADER_DIR, source, '-o', binary]);
  const out = execFileSync(binary, { encoding: 'utf8' }).trim();
  const result = Object.fromEntries(out.split(' ').map(pair => pair.split('=')));

  expect(result).toEqual({
    white: '1', // the iPhone's failed render
    grey: '1', // any flat colour, not just white
    gradient: '0',
    onePixel: '0', // a single differing channel is enough to be a picture
    rgbaWhite: '1',
    null: '1',
  });
});
