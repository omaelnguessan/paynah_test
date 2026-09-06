import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

/**
 * The dependency rule, checked rather than described.
 *
 * ESLint enforces the same thing while you type; this test is what fails the
 * build, so an architecture violation cannot reach a reviewer as a warning
 * somebody skipped. It reads the real import statements — nothing is mocked.
 */
const SOURCE_ROOT = resolve(__dirname);

type Layer = 'domain' | 'application' | 'infrastructure' | 'presentation';

/** What a file in each layer may not import. Arrows only ever point inwards. */
const FORBIDDEN: Readonly<Record<Layer, { layers: Layer[]; packages: RegExp[] }>> = {
  // Layer 0: no outgoing dependency at all, framework included.
  domain: {
    layers: ['application', 'infrastructure', 'presentation'],
    packages: [
      /^@nestjs\//,
      /^typeorm/,
      /^axios/,
      /^rxjs/,
      /^class-validator/,
      /^class-transformer/,
      /^@paynad\/shared/,
      /^pino/,
      /^nestjs-pino/,
    ],
  },
  // Layer 1: may orchestrate the domain and use Nest for wiring, nothing technical.
  application: {
    layers: ['infrastructure', 'presentation'],
    packages: [/^typeorm/, /^axios/],
  },
  // Layer 2 implements the ports; it must not reach back up to the HTTP layer.
  infrastructure: { layers: ['presentation'], packages: [] },
  // Layer 3 is the outermost; it may depend on everything below it.
  presentation: { layers: [], packages: [] },
};

const IMPORT_PATTERN = /(?:^|\n)\s*import\s+(?:type\s+)?(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g;

function sourceFiles(directory: string): string[] {
  const entries = readdirSync(directory);
  return entries.flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

function importsOf(path: string): string[] {
  const content = readFileSync(path, 'utf8');
  const found: string[] = [];
  for (const match of content.matchAll(IMPORT_PATTERN)) {
    found.push(match[1]);
  }
  return found;
}

/** Resolves a relative specifier to the layer it lands in, if any. */
function layerOf(specifier: string, fromFile: string): Layer | null {
  const absolute = specifier.startsWith('.')
    ? resolve(fromFile, '..', specifier)
    : join(SOURCE_ROOT, specifier);
  const path = relative(SOURCE_ROOT, absolute);
  const [head] = path.split('/');
  return (['domain', 'application', 'infrastructure', 'presentation'] as Layer[]).includes(
    head as Layer,
  )
    ? (head as Layer)
    : null;
}

describe('the dependency rule', () => {
  const layers = Object.keys(FORBIDDEN) as Layer[];

  it.each(layers)('%s has files to check', (layer) => {
    expect(sourceFiles(join(SOURCE_ROOT, layer)).length).toBeGreaterThan(0);
  });

  describe.each(layers)('%s', (layer) => {
    const rules = FORBIDDEN[layer];
    const files = sourceFiles(join(SOURCE_ROOT, layer));

    it('imports no layer further out', () => {
      const violations = files.flatMap((file) =>
        importsOf(file)
          .filter((specifier) => {
            const target = layerOf(specifier, file);
            return target !== null && rules.layers.includes(target);
          })
          .map((specifier) => `${relative(SOURCE_ROOT, file)} imports ${specifier}`),
      );

      expect(violations).toEqual([]);
    });

    it('imports no forbidden package', () => {
      const violations = files.flatMap((file) =>
        importsOf(file)
          .filter(
            (specifier) =>
              !specifier.startsWith('.') &&
              rules.packages.some((pattern) => pattern.test(specifier)),
          )
          .map((specifier) => `${relative(SOURCE_ROOT, file)} imports ${specifier}`),
      );

      expect(violations).toEqual([]);
    });
  });

  it('keeps the aggregate free of persistence decorators', () => {
    const domain = sourceFiles(join(SOURCE_ROOT, 'domain'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    // The single most reliable tell that clean architecture is cosmetic.
    expect(domain).not.toMatch(/@(Column|Entity|PrimaryGeneratedColumn|ManyToOne|OneToMany)\(/);
    expect(domain).not.toMatch(/@(Injectable|Controller|ApiProperty|IsString|Expose)\(/);
  });

  it('detects a violation when there is one', () => {
    // Guards the guard: a rule that cannot fail proves nothing.
    expect(layerOf('../../infrastructure/persistence/x', join(SOURCE_ROOT, 'domain/model/x.ts')))
      .toBe('infrastructure');
    expect(FORBIDDEN.domain.packages.some((pattern) => pattern.test('@nestjs/common'))).toBe(true);
  });
});
