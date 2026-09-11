import assert from 'node:assert/strict';
import test from 'node:test';

import { formatIosTestLine } from '../format-ios-test-output.mjs';

test('prints XCTest results at test and suite level', () => {
  assert.equal(
    formatIosTestLine("Test Case '-[OffgridMobileTests.ModelTests testLoads]' passed (0.042 seconds)."),
    '✓ OffgridMobileTests.ModelTests › testLoads (0.042 seconds)',
  );
  assert.equal(
    formatIosTestLine("Test Suite 'OffgridMobileTests.xctest' failed at 2026-09-05 12:00:00.000."),
    '✗ suite OffgridMobileTests.xctest',
  );
});

test('prints summaries and final status', () => {
  assert.equal(
    formatIosTestLine('Executed 12 tests, with 1 failure (0 unexpected) in 2.000 (2.100) seconds'),
    'Executed 12 tests, with 1 failure (0 unexpected) in 2.000 (2.100) seconds',
  );
  assert.equal(formatIosTestLine('** TEST SUCCEEDED **'), '✓ iOS tests passed');
  assert.equal(formatIosTestLine('** TEST FAILED **'), '✗ iOS tests failed');
});

test('hides compiler commands and dependency warnings', () => {
  assert.equal(formatIosTestLine('SwiftCompile normal arm64 Compiling DocPicker.swift'), null);
  assert.equal(formatIosTestLine('sqlite3.c:183463:40: warning: implicit conversion loses integer precision'), null);
  assert.equal(formatIosTestLine('103 warnings generated.'), null);
});
