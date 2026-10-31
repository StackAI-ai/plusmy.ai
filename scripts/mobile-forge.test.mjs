import assert from 'node:assert/strict';
import { generateKeyPairSync, X509Certificate } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expoPackage = require.resolve('expo/package.json', { paths: [resolve(root, 'apps/mobile')] });
const cliPackage = require.resolve('@expo/cli/package.json', { paths: [dirname(expoPackage)] });
const signingPackage = require.resolve('@expo/code-signing-certificates/package.json', { paths: [dirname(cliPackage)] });
const selfsignedPackage = require.resolve('selfsigned/package.json', { paths: [dirname(cliPackage)] });
const cliRequire = createRequire(cliPackage);
const signingRequire = createRequire(signingPackage);
const selfsignedRequire = createRequire(selfsignedPackage);
const forge = cliRequire('node-forge');
const signing = signingRequire('./build/main.js');
const selfsigned = selfsignedRequire('./index.js');
const pem = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' }
});
const keyPair = signing.convertKeyPairPEMToKeyPair({ privateKeyPEM: pem.privateKey, publicKeyPEM: pem.publicKey });

test('Expo CLI, code-signing and selfsigned resolve the patched forge version', () => {
  for (const consumer of [cliRequire, signingRequire, selfsignedRequire]) {
    assert.equal(consumer('node-forge/package.json').version, '1.4.2');
  }
});

test('Expo code-signing generates, validates and uses a disposable certificate', () => {
  const certificate = signing.generateSelfSignedCodeSigningCertificate({
    keyPair, commonName: 'disposable-expo-test',
    validityNotBefore: new Date(Date.now() - 60_000),
    validityNotAfter: new Date(Date.now() + 3_600_000)
  });
  signing.validateSelfSignedCertificate(certificate, keyPair);
  const roundTrip = signing.convertCertificatePEMToCertificate(signing.convertCertificateToCertificatePEM(certificate));
  signing.validateSelfSignedCertificate(roundTrip, keyPair);
  const signature = signing.signBufferRSASHA256AndVerify(keyPair.privateKey, roundTrip, Buffer.from('disposable fixture'));
  assert.ok(Buffer.from(signature, 'base64').length > 0);
});

test('local development selfsigned certificate remains usable', () => {
  const generated = selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    keySize: 2048, days: 1, algorithm: 'sha256'
  });
  const certificate = new X509Certificate(generated.cert);
  assert.equal(certificate.verify(certificate.publicKey), true);
});

test('certificate chain verification rejects a non-CA intermediate', () => {
  function certificate(name, issuer, isCa, serial) {
    const value = forge.pki.createCertificate();
    value.publicKey = keyPair.publicKey;
    value.serialNumber = serial;
    value.validity.notBefore = new Date(Date.now() - 60_000);
    value.validity.notAfter = new Date(Date.now() + 3_600_000);
    value.setSubject([{ name: 'commonName', value: name }]);
    value.setIssuer([{ name: 'commonName', value: issuer }]);
    value.setExtensions([
      { name: 'basicConstraints', cA: isCa, critical: true },
      { name: 'keyUsage', keyCertSign: isCa, digitalSignature: true, critical: true }
    ]);
    value.sign(keyPair.privateKey, forge.md.sha256.create());
    return value;
  }
  const rootCertificate = certificate('root', 'root', true, '01');
  const goodIntermediate = certificate('intermediate', 'root', true, '02');
  const badIntermediate = certificate('intermediate', 'root', false, '03');
  const leaf = certificate('leaf', 'intermediate', false, '04');
  const trust = forge.pki.createCaStore([rootCertificate]);
  assert.equal(forge.pki.verifyCertificateChain(trust, [leaf, goodIntermediate]), true);
  assert.throws(() => forge.pki.verifyCertificateChain(trust, [leaf, badIntermediate]));
});
