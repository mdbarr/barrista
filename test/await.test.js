'use strict';

async function getData () {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ key: 'important key' }), 1000);
  });
}

describe('await data test', () => {
  let obj = {};

  describe('first', () => {
    it('get obj data', async () => {
      obj = await getData();
    });
  });

  describe('second', () => {
    it(`check ${ obj.key }`, async () => {
      await expect(obj.key).to.be.a.String();
      await expect(obj.key).to.include('important');
    });
  });
});
