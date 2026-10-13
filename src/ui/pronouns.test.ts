import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toWomen } from './pronouns.ts';

test('the women\'s game speaks of its players as women — and leaves every other word alone', () => {
  assert.equal(toWomen('He wants to leave; his agent says the club told him to stay.'), 'She wants to leave; her agent says the club told her to stay.');
  assert.equal(toWomen("He's flying. HIS FORM: 7.4. He picked himself up."), "She's flying. HER FORM: 7.4. She picked herself up.");
  assert.equal(toWomen('Thank you, boys! An ambitious lad, the lads say.'), 'Thank you, girls! An ambitious player, the players say.');
  // Words that only contain the letters.
  const untouched = 'The theme of the heat: history, chemistry, Shevchenko, Hisham, whisper, the helmet, hey, hi, Hisham.';
  assert.equal(toWomen(untouched), untouched);
  assert.equal(toWomen(''), '');
});
