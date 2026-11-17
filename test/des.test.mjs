/**
 * DES-ECB vector test for the XZZ part-block cipher.
 *
 * Node's bundled OpenSSL 3 no longer exposes `des-ecb`, so this module is our
 * own implementation and its whole value rests on being correct. Two published
 * FIPS 46-3 vectors are the check. Run with `node test/des.test.mjs`.
 */
import { desEcbDecrypt } from '../xzz-des.js'

const failures = []

function check(label, expectedHex, actualBuffer) {
  const actual = actualBuffer.toString('hex').toUpperCase()
  const expected = expectedHex.toUpperCase()
  if (actual === expected) {
    console.log(`  ok   ${label}`)
  } else {
    console.log(`  FAIL ${label}: expected ${expected}, got ${actual}`)
    failures.push(label)
  }
}

console.log('DES test vectors')
check(
  'key 133457799BBCDFF1 decrypts ciphertext 85E813540F0AB405',
  '0123456789ABCDEF',
  desEcbDecrypt(Buffer.from('85E813540F0AB405', 'hex'), 0, 8, Buffer.from('133457799BBCDFF1', 'hex')),
)

check(
  'key 0E329232EA6D0D73 decrypts all-zero ciphertext',
  '8787878787878787',
  desEcbDecrypt(Buffer.from('0000000000000000', 'hex'), 0, 8, Buffer.from('0E329232EA6D0D73', 'hex')),
)

// A trailing partial block must be passed through untouched, because XZZ part
// payloads are not block aligned.
const partial = desEcbDecrypt(Buffer.from('0011223344', 'hex'), 0, 5, Buffer.from('dcfc12ac00000000', 'hex'))
check('a partial trailing block is copied through', '0011223344', partial)

// Decrypting at an offset must equal decrypting a slice.
const twoBlocks = Buffer.from('85E813540F0AB40585E813540F0AB405', 'hex')
const key = Buffer.from('133457799BBCDFF1', 'hex')
check(
  'an offset read matches a sliced read',
  desEcbDecrypt(twoBlocks.subarray(8), 0, 8, key).toString('hex'),
  desEcbDecrypt(twoBlocks, 8, 8, key),
)

if (failures.length > 0) {
  console.log(`\n${failures.length} DES CHECK(S) FAILED`)
  process.exitCode = 1
} else {
  console.log('\nDES VECTORS PASS')
}
