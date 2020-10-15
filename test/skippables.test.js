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

  xdescribe('xdescribe', () => {
    it('should be skipped', () => {
      console.log('nope');
    });
  });
});
