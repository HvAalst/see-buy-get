import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * OpenAPI drift gate. Runs after `npm run spec` emits contracts/openapi.json and fails the build on
 * contract regressions that generation would otherwise ossify silently:
 *   - the brand title drifts off "SeeBuyGet API"
 *   - any operation loses its operationId, or two operations collide (breaks a generated client)
 *   - a request body resolves to a property-less schema (a DTO the swagger plugin never introspected —
 *     the classic "all-empty schemas" failure)
 *   - an operation declares no responses at all
 *
 * It reads the emitted JSON (not the app) so it also guards a hand-edited or stale contract file.
 */
interface SchemaLite {
  $ref?: string;
  type?: string;
  properties?: Record<string, unknown>;
  allOf?: unknown[];
  oneOf?: unknown[];
  anyOf?: unknown[];
}
interface OperationLite {
  operationId?: string;
  responses?: Record<string, unknown>;
  requestBody?: { content?: Record<string, { schema?: SchemaLite }> };
}
interface DocLite {
  info: { title: string };
  paths: Record<string, Record<string, OperationLite>>;
  components?: { schemas?: Record<string, SchemaLite> };
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);
const EXPECTED_TITLE = 'SeeBuyGet API';

function deref(doc: DocLite, schema: SchemaLite | undefined): SchemaLite | undefined {
  if (!schema) return undefined;
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop() as string;
    return doc.components?.schemas?.[name];
  }
  return schema;
}

function main(): void {
  const file = resolve(process.cwd(), 'contracts', 'openapi.json');
  const doc = JSON.parse(readFileSync(file, 'utf8')) as DocLite;
  const errors: string[] = [];
  const operationIds: string[] = [];

  if (doc.info.title !== EXPECTED_TITLE) errors.push(`info.title is "${doc.info.title}", expected "${EXPECTED_TITLE}"`);

  for (const [path, ops] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      if (!HTTP_METHODS.has(method)) continue;
      const where = `${method.toUpperCase()} ${path}`;

      if (!op.operationId) errors.push(`${where}: missing operationId`);
      else operationIds.push(op.operationId);

      if (!op.responses || Object.keys(op.responses).length === 0) errors.push(`${where}: declares no responses`);

      const reqSchema = deref(doc, op.requestBody?.content?.['application/json']?.schema);
      if (reqSchema && reqSchema.type === 'object' && !reqSchema.allOf && !reqSchema.oneOf && !reqSchema.anyOf) {
        const propCount = Object.keys(reqSchema.properties ?? {}).length;
        if (propCount === 0) errors.push(`${where}: request body schema has no properties (DTO not introspected by the swagger plugin?)`);
      }
    }
  }

  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of operationIds) (seen.has(id) ? dupes : seen).add(id);
  if (dupes.size) errors.push(`duplicate operationIds: ${[...dupes].join(', ')}`);

  if (errors.length) {
    // eslint-disable-next-line no-console
    console.error(`✗ OpenAPI gate: ${errors.length} problem(s):`);
    // eslint-disable-next-line no-console
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`✓ OpenAPI gate: ${operationIds.length} operations, ${seen.size} unique operationIds, title "${EXPECTED_TITLE}".`);
}

main();
