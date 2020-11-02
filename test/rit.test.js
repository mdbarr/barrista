'use strict';

describe('retry it test', () => {
  let i = 0;

  rit('retry me', () => {
    i++;
    console.log('got', i);
    expect(i).to.equal(10);
  });

  rit('not actually', () => {
    const a = {};
    a.b.c = 10;
  });
});
