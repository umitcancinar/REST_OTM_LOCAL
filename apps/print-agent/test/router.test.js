const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { sendToPrinter } = require('../dist/printer/router.js');

test('network printer transport delivers the complete paced payload', async (t) => {
  const expected = Buffer.alloc(4097, 0x5a);
  const received = [];
  const server = net.createServer((socket) => {
    socket.on('data', (chunk) => received.push(chunk));
  });
  t.after(() => server.close());

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');

  const success = await sendToPrinter('', expected, '127.0.0.1', address.port);
  assert.equal(success, true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(Buffer.concat(received), expected);
});

test('network printer transport rejects an invalid address', async () => {
  assert.equal(await sendToPrinter('', Buffer.from('test'), 'not-an-ip', 9100), false);
});
