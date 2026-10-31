import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage, translate } from './language.ts';
import { PHRASES } from './translations.ts';

test('the game in Portuguese and Spanish: whole pieces of text, their spacing kept — and the rest left in English', () => {
  setLanguage('pt');
  assert.equal(translate('Continue'), 'Continuar');
  assert.equal(translate(' Quick Start '), ' Início rápido ');
  assert.equal(translate('Sat 3 Oct'), 'Sáb 3 Out');
  assert.equal(translate('December 2026'), 'Dezembro 2026');
  assert.equal(translate('Setter:'), 'Distribuidor:');
  // An achievement reached: its hint, without the full stop, and the day.
  assert.equal(translate('Win a match · 12 Oct 2026'), 'Ganha um jogo · 12 Out 2026');
  // A name, or a sentence nobody has translated yet, is as it was.
  assert.equal(translate('Kamil Sokół'), 'Kamil Sokół');
  assert.equal(translate('Continue to the next round'), 'Continue to the next round');

  setLanguage('es');
  assert.equal(translate('Timeout'), 'Tiempo muerto');
  assert.equal(translate('Mon 12 Jan 2027'), 'Lun 12 Ene 2027');

  setLanguage('en');
  assert.equal(translate('Continue'), 'Continue');
});

test('every row of the dictionary has both translations, and no English is in it twice', () => {
  const seen = new Set<string>();
  for (const [en, pt, es] of PHRASES) {
    assert.ok(pt.trim() !== '' && es.trim() !== '', `"${en}" is translated`);
    assert.ok(!seen.has(en), `"${en}" is in the dictionary once`);
    seen.add(en);
  }
});
