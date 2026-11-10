import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage, translate } from './language.ts';
import { PHRASES } from './translations.ts';
import { TEXT_PHRASES } from './translationsText.ts';

test('the game in Portuguese and Spanish: whole pieces of text, their spacing kept — and the rest left in English', () => {
  setLanguage('pt');
  assert.equal(translate('Continue'), 'Continuar');
  assert.equal(translate(' Quick Start '), ' Início rápido ');
  assert.equal(translate('Sat 3 Oct'), 'Sáb 3 Out');
  assert.equal(translate('December 2026'), 'Dezembro 2026');
  assert.equal(translate('Setter:'), 'Distribuidor:');
  // An achievement reached: its hint, without the full stop, and the day.
  assert.equal(translate('Win a match · 12 Oct 2026'), 'Ganha um jogo · 12 Out 2026');
  // Holes, filled with what stands there — and a sentence written in pieces looked up whole.
  assert.equal(translate('Finish 3rd or better'), 'Terminar em 3.º ou melhor');
  assert.equal(translate('Season 2'), 'Época 2');
  assert.equal(translate('2026/27 · this season'), '2026/27 · esta época');
  assert.equal(translate('In 3 months'), 'Daqui a 3 meses');
  assert.equal(translate('9 Sept 2026'), '9 Set 2026');
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
  for (const [en, pt, es] of [...PHRASES, ...TEXT_PHRASES]) {
    assert.ok(pt.trim() !== '' && es.trim() !== '', `"${en}" is translated`);
    assert.ok(!seen.has(en), `"${en}" is in the dictionary once`);
    seen.add(en);
  }
});

test('the game own written text: a sentence with names in it, and a paragraph the game wrote a sentence at a time', () => {
  setLanguage('es');
  assert.equal(translate('Gwardia Radom face Siatkarz in the final.'), 'Gwardia Radom se enfrentan a Siatkarz en la final.');
  assert.equal(translate('You have no club. The set is over.'), 'No tienes club. El set ha terminado.');
  setLanguage('pt');
  assert.equal(translate('The match is over.'), 'O jogo acabou.');
  setLanguage('en');
});

test('an academy training report, line by line — the attributes that went up by their own names', () => {
  const report = 'Paweł Wójcik, 4 weeks into his attacking programme (intensive).\nAbility: 1092 → 1105 (+13).\n' +
    'Improved: Spike Technique +2, Quick Attack +1.\nSteady progress — it is going in the right direction.';
  setLanguage('pt');
  assert.equal(translate(report),
    'Paweł Wójcik, 4 semanas no programa de ataque (intensivo).\nHabilidade: 1092 → 1105 (+13).\n' +
    `Melhorou: ${translate('Spike Technique')} +2, ${translate('Quick Attack')} +1.\nProgresso constante — vai no bom caminho.`);
  assert.notEqual(translate('Spike Technique'), 'Spike Technique');
  setLanguage('en');
});
