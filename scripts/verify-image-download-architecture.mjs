#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const repoRoot = path.resolve(import.meta.dirname, '..')
const applicationFiles = [
  'src/screens/ModelsScreen/useImageModels.ts',
  'src/services/adapters/models/downloads/publicImageDownloadRequest.ts',
  'src/services/modelServices/applicationDownloadPorts.ts',
]
const deletedOwners = [
  'src/services/imageDownloadActions.ts',
  'src/services/imageDownloadResume.ts',
  'src/services/imageDownloadRetry.ts',
  'src/services/imageModelDownloadOwner.ts',
]
const violations = []

for (const relative of deletedOwners) {
  if (fs.existsSync(path.join(repoRoot, relative))) {
    violations.push({ file: relative, line: 1, detail: 'legacy image download owner still exists' })
  }
}

for (const relative of applicationFiles) {
  const absolute = path.join(repoRoot, relative)
  const source = ts.createSourceFile(
    absolute,
    fs.readFileSync(absolute, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const report = (node, detail) => violations.push({
    file: relative,
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    detail,
  })
  const visit = node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const importsProjection = node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings) &&
        node.importClause.namedBindings.elements.some(element =>
          ['modelDownloadProjection', 'useDownloadStore'].includes(element.name.text))
      if (/stores\/downloadStore/.test(node.moduleSpecifier.text) && importsProjection) {
        report(node, 'imports a writable Mobile download projection')
      }
    }
    if (
      ts.isNewExpression(node) &&
      /^(Map|AbortController|DownloadOperationRegistry|ModelDownloadProjectionController)$/.test(
        node.expression.getText(source),
      )
    ) report(node, `creates ${node.expression.getText(source)}`)
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      /^(makeMultifileId|startMultifileRuntime|addImageEntry)$/.test(node.name.text)
    ) report(node, `declares legacy state owner ${node.name.text}`)
    if (ts.isStringLiteralLike(node) && /^(image-multi:|queued:image:)/.test(node.text)) {
      report(node, `owns download identity ${node.text}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

if (violations.length) {
  for (const violation of violations) {
    console.error(
      `VIOLATION image-download-policy-uses-shared-workflow: ${violation.file}:${violation.line} ${violation.detail}`,
    )
  }
  process.exitCode = 1
} else {
  console.log('Mobile image download architecture gate passed.')
}
