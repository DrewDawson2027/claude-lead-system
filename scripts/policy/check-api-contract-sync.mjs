#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const schemaPath = resolve(root, 'sidecar/server/http/schema.ts');
const contractPath = resolve(root, 'docs/API_CONTRACT.md');

const schemaSrc = readFileSync(schemaPath, 'utf8');
const contractSrc = readFileSync(contractPath, 'utf8');

function parseSchemaRoutes(src) {
  const routes = new Map();
  const routeMatcher =
    /method:\s*["']([A-Z]+)["']\s*,\s*\n\s*path:\s*["']([^"']+)["']([\s\S]*?)\n\s*response:/g;

  for (const match of src.matchAll(routeMatcher)) {
    const method = match[1];
    const path = match[2];
    const routeSection = match[3];
    const key = `${method} ${path}`;

    const requiredBodyFields = [];
    const bodyMatch = routeSection.match(/body:\s*\{([\s\S]*?)\}\s*,/);
    if (bodyMatch) {
      const requiredMatch = bodyMatch[1].match(/required:\s*\[([^\]]*)\]/);
      if (requiredMatch) {
        for (const fieldMatch of requiredMatch[1].matchAll(/["']([^"']+)["']/g)) {
          requiredBodyFields.push(fieldMatch[1]);
        }
      }
    }

    routes.set(key, {
      method,
      path,
      requiredBodyFields,
    });
  }

  return routes;
}

function parseMarkdownRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const withoutEdges = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return withoutEdges.split('|').map((cell) => cell.trim());
}

function parseContractRoutes(src) {
  const routes = new Map();
  const lines = src.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const headerCells = parseMarkdownRow(lines[i]);
    if (!headerCells || i + 1 >= lines.length) continue;
    if (!/^\|\s*[-:]+(?:\s*\|\s*[-:]+)+\s*\|$/.test(lines[i + 1].trim())) continue;

    const normalizedHeaders = headerCells.map((header) => header.toLowerCase());
    const bodyColumnIndex = normalizedHeaders.findIndex((header) => header.startsWith('body'));

    i += 2;
    for (; i < lines.length; i += 1) {
      const rowCells = parseMarkdownRow(lines[i]);
      if (!rowCells || rowCells.every((cell) => cell === '')) break;

      const methodMatch = rowCells[0]?.match(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS)$/);
      const pathMatch = rowCells[1]?.match(/`([^`]+)`/);
      if (!methodMatch || !pathMatch) continue;

      const key = `${methodMatch[1]} ${pathMatch[1]}`;
      routes.set(key, {
        bodyCell: bodyColumnIndex >= 0 ? (rowCells[bodyColumnIndex] ?? '') : '',
      });
    }
  }

  return routes;
}

function parseDocumentedBodyFields(bodyCell) {
  const cleaned = bodyCell.replaceAll('`', '').trim();
  if (!cleaned || cleaned === '—' || cleaned === '-') {
    return { present: false, fields: new Set(), optionalFields: new Set() };
  }

  const shapeMatch = cleaned.match(/\{([^}]*)\}/);
  if (!shapeMatch) {
    return { present: false, fields: new Set(), optionalFields: new Set() };
  }

  const fields = new Set();
  const optionalFields = new Set();

  for (const rawPart of shapeMatch[1].split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    const tokenMatch = part.match(/^([A-Za-z0-9_]+)(\?)?$/);
    if (!tokenMatch) continue;
    const fieldName = tokenMatch[1];
    fields.add(fieldName);
    if (tokenMatch[2]) optionalFields.add(fieldName);
  }

  return { present: true, fields, optionalFields };
}

const schemaRoutes = parseSchemaRoutes(schemaSrc);
const contractRoutes = parseContractRoutes(contractSrc);

const schemaSet = new Set(schemaRoutes.keys());
const contractSet = new Set(contractRoutes.keys());

const missingInDocs = [...schemaSet].filter((route) => !contractSet.has(route));
const missingInSchema = [...contractSet].filter((route) => !schemaSet.has(route));
const requiredBodyFieldDrift = [];

for (const [routeKey, route] of schemaRoutes.entries()) {
  if (route.requiredBodyFields.length === 0) continue;
  const documented = contractRoutes.get(routeKey);
  if (!documented) continue;

  const parsed = parseDocumentedBodyFields(documented.bodyCell);
  if (!parsed.present) continue;

  const missingFields = route.requiredBodyFields.filter(
    (field) => !parsed.fields.has(field) || parsed.optionalFields.has(field),
  );

  if (missingFields.length > 0) {
    requiredBodyFieldDrift.push({ route: routeKey, missingFields });
  }
}

if (missingInDocs.length || missingInSchema.length || requiredBodyFieldDrift.length) {
  console.error('API contract drift detected.');
  if (missingInDocs.length) {
    console.error('Missing in docs:');
    for (const route of missingInDocs) console.error(`  - ${route}`);
  }
  if (missingInSchema.length) {
    console.error('Missing in schema:');
    for (const route of missingInSchema) console.error(`  - ${route}`);
  }
  if (requiredBodyFieldDrift.length) {
    console.error('Required body field drift:');
    for (const drift of requiredBodyFieldDrift) {
      console.error(`  - ${drift.route} missing required fields in docs: ${drift.missingFields.join(', ')}`);
    }
  }
  process.exit(1);
}

console.log(`api-contract sync check passed (${schemaSet.size} schema routes checked)`);
