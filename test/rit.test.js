'use strict';

describe('retry it test', () => {
  let i = 0;

  rit('retry me', () => {
    i++;
    console.log('got', i);
    expect(i).to.equal(20);
  });
});
