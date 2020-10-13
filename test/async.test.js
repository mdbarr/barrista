'use strict';

describe('afoo', () => {
  describe('abar', async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log('sorta');

    it('long resolve', async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log('here');
    });
  });

  describe('bbar', () => {
    console.log('bbar');
  });
});
