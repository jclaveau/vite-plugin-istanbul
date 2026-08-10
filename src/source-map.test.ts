import { SourceMapConsumer, SourceMapGenerator } from 'source-map';
import { describe, expect, it } from 'vitest';

import { createCompleteSourceMap, RawSourceMap } from './source-map';

// Keeps fixture line numbers intact while letting them sit at the test's indent.
// TODO(reviewer): prefer the `dedent` package (MIT) over this? Costs a devDep.
function dedent(strings: TemplateStringsArray): string {
  const lines = strings.join('').replace(/^\n/, '').split('\n');
  const widths = lines
    .filter((line) => line.trim())
    .map((line) => line.length - line.trimStart().length);
  const indent = Math.min(...widths);

  return lines.map((line) => line.slice(indent)).join('\n');
}

// Stands in for what Vite hands the transform hook: the script block is mapped,
// the template-derived render code that follows it is not.
function combinedMapFor(
  mappedLines: Array<[generated: number, original: number]>
): RawSourceMap {
  const gen = new SourceMapGenerator({ file: 'Example.vue' });

  for (const [generated, original] of mappedLines) {
    gen.addMapping({
      source: 'Example.vue',
      original: { line: original, column: 0 },
      generated: { line: generated, column: 0 },
    });
  }

  return JSON.parse(gen.toString());
}

async function originalLineOf(
  map: unknown,
  generatedLine: number
): Promise<number | null> {
  return await SourceMapConsumer.with(map as never, null, (consumer) => {
    return consumer.originalPositionFor({ line: generatedLine, column: 0 })
      .line;
  });
}

const sfc = dedent`
  <template>
    <p/>
  </template>

  <script setup>
  const a = 1;

  function f() {
    return a;
  }
  </script>
`;

const scriptChunk = dedent`
  const a = 1;

  function f() {
    return a;
  }
`;

describe('createCompleteSourceMap', () => {
  it('takes script positions from the combined map', async () => {
    const map = createCompleteSourceMap(
      'Example.vue',
      scriptChunk,
      sfc,
      { file: 'Example.vue' },
      combinedMapFor([
        [1, 6],
        [3, 8],
        [4, 9],
      ])
    );

    expect(await originalLineOf(map, 1)).toBe(6);
    expect(await originalLineOf(map, 3)).toBe(8);
  });

  it('follows the combined map when the chunk is not line-for-line', async () => {
    // A hoisted import shifts the body down by one, which an offset cannot express.
    const map = createCompleteSourceMap(
      'Example.vue',
      scriptChunk,
      sfc,
      { file: 'Example.vue' },
      combinedMapFor([
        [1, 6],
        [3, 9],
      ])
    );

    expect(await originalLineOf(map, 3)).toBe(9);
  });

  it('synthesises a mapping for lines the combined map does not cover', async () => {
    const map = createCompleteSourceMap(
      'Example.vue',
      scriptChunk,
      sfc,
      { file: 'Example.vue' },
      combinedMapFor([[1, 6]])
    );

    expect(await originalLineOf(map, 3)).toBe(3);
  });

  it('still maps line-for-line without a combined map', async () => {
    const map = createCompleteSourceMap(
      'plain.ts',
      dedent`
        const a = 1;
        const b = 2;
      `,
      dedent`
        const a = 1;
        const b = 2;
      `,
      { file: 'plain.ts' }
    );

    expect(await originalLineOf(map, 2)).toBe(2);
  });
});
