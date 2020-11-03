'use strict';

const { join } = require('path');
const { size } = require('barrkeep/utils');

describe('requires test', () => {
  it('joiner', () => {
    expect(join('a', 'b')).to.equal('a/b');
  });

  it('sizer', () => {
    expect(size({ a: 10 })).to.equal(1);
  });
});
