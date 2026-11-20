const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const altcha = require('../lib/altcha');

test('altcha: createChallenge generates a valid cryptographically signed challenge', () => {
	const ch = altcha.createChallenge({ maxnumber: 5000 });
	assert.equal(ch.algorithm, 'SHA-256');
	assert.ok(ch.challenge && typeof ch.challenge === 'string');
	assert.ok(ch.salt && typeof ch.salt === 'string');
	assert.ok(ch.signature && typeof ch.signature === 'string');
	assert.equal(ch.maxnumber, 5000);
});

test('altcha: verifySolution validates a solved challenge and prevents replay', () => {
	const ch = altcha.createChallenge({ maxnumber: 500 });
	let solvedNumber = null;

	// Solve PoW
	for (let n = 0; n <= 500; n++) {
		const hash = crypto.createHash('sha256').update(ch.salt + n).digest('hex');
		if (hash === ch.challenge) {
			solvedNumber = n;
			break;
		}
	}
	assert.notEqual(solvedNumber, null, 'PoW should find the solution within maxnumber');

	const payloadObj = {
		algorithm: ch.algorithm,
		challenge: ch.challenge,
		number: solvedNumber,
		salt: ch.salt,
		signature: ch.signature,
	};
	const payloadBase64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64');

	// First verification: must succeed
	const firstCheck = altcha.verifySolution(payloadBase64);
	assert.equal(firstCheck, true, 'Valid solved challenge should verify successfully');

	// Replay verification: must fail
	const secondCheck = altcha.verifySolution(payloadBase64);
	assert.equal(secondCheck, false, 'Replay of the same signature must be rejected');
});

test('altcha: verifySolution rejects invalid number and tampered signature', () => {
	const ch = altcha.createChallenge({ maxnumber: 1000 });

	// Tampered number
	const tamperedPayload = Buffer.from(
		JSON.stringify({
			algorithm: ch.algorithm,
			challenge: ch.challenge,
			number: 999999,
			salt: ch.salt,
			signature: ch.signature,
		}),
	).toString('base64');
	assert.equal(altcha.verifySolution(tamperedPayload), false);

	// Tampered signature
	const forgedPayload = Buffer.from(
		JSON.stringify({
			algorithm: ch.algorithm,
			challenge: ch.challenge,
			number: 1,
			salt: ch.salt,
			signature: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
		}),
	).toString('base64');
	assert.equal(altcha.verifySolution(forgedPayload), false);

	// Garbage payload
	assert.equal(altcha.verifySolution('not-a-base64-json'), false);
	assert.equal(altcha.verifySolution(null), false);
});
