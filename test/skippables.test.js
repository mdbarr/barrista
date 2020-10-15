'use strict';

describe('skippables', () => {
  describe('xits', () => {
    xit('xited', () => {
      console.log('nope');
    });

    it('should run', () => {
      console.log('yes');
    });

    xit('xited', () => {
      console.log('nope');
    });
  });
});
