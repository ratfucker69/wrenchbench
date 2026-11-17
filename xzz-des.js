/**
 * DES-ECB decryption for the XZZ boardview container.
 *
 * The XZZ format encrypts only its part blocks, with a fixed key and ECB mode,
 * so this is a plain single-block decryptor — no modes, no padding oracle, no
 * key derivation. It exists because Node's bundled OpenSSL 3 no longer exposes
 * `des-ecb` and shipping a native dependency for one fixed-key cipher would be
 * worse than 200 lines of table-driven arithmetic.
 *
 * The round function uses the classic SP-table optimisation: the eight S-boxes
 * are folded through the P permutation once at module load, so a round costs
 * eight lookups instead of eight lookups plus a 32-bit permutation.
 */

const PC1 = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18,
  10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
  63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22,
  14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4,
]

const PC2 = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10,
  23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
  41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48,
  44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
]

const IP = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
  62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
]

const FP = [
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31,
  38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
  34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
]

const E = [
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9,
  8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17,
  16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25,
  24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
]

const P = [
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
  2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25,
]

const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]

const SBOXES = [
  [
    14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7,
    0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
    4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0,
    15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13,
  ],
  [
    15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10,
    3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5,
    0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15,
    13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9,
  ],
  [
    10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8,
    13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
    13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7,
    1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12,
  ],
  [
    7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15,
    13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
    10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4,
    3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14,
  ],
  [
    2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9,
    14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
    4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14,
    11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3,
  ],
  [
    12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11,
    10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
    9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6,
    4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13,
  ],
  [
    4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1,
    13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
    1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2,
    6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12,
  ],
  [
    13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7,
    1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
    7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8,
    2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11,
  ],
]

/** Apply a 1-based, MSB-first bit permutation to a 32-bit word. */
function permute32(value, table) {
  let out = 0
  for (let index = 0; index < 32; index += 1) {
    const bit = (value >>> (31 - (table[index] - 1))) & 1
    out = (out * 2 + bit) >>> 0
  }
  return out
}

/** Apply a 1-based, MSB-first bit permutation to a 64-bit block held as hi/lo. */
function permute64(hi, lo, table) {
  let outHi = 0
  let outLo = 0
  for (let index = 0; index < table.length; index += 1) {
    const position = table[index] - 1
    const bit = position < 32 ? (hi >>> (31 - position)) & 1 : (lo >>> (63 - position)) & 1
    if (index < 32) outHi = (outHi * 2 + bit) >>> 0
    else outLo = (outLo * 2 + bit) >>> 0
  }
  return { hi: outHi, lo: outLo }
}

/**
 * Byte-contribution tables for a 64-bit permutation: XOR-ing the contribution
 * of each input byte yields the permuted block, so IP and FP cost 8 lookups and
 * a handful of XORs instead of 64 bit tests.
 */
function buildByteTables(table) {
  const perByte = new Array(8)
  for (let byteIndex = 0; byteIndex < 8; byteIndex += 1) {
    const contributions = new Uint32Array(256 * 2)
    for (let value = 0; value < 256; value += 1) {
      let hi = 0
      let lo = 0
      for (let bitIndex = 0; bitIndex < 8; bitIndex += 1) {
        if (((value >>> (7 - bitIndex)) & 1) === 0) continue
        const sourcePosition = byteIndex * 8 + bitIndex
        for (let out = 0; out < table.length; out += 1) {
          if (table[out] - 1 !== sourcePosition) continue
          if (out < 32) hi = (hi + 2 ** (31 - out)) >>> 0
          else lo = (lo + 2 ** (63 - out)) >>> 0
        }
      }
      contributions[value * 2] = hi
      contributions[value * 2 + 1] = lo
    }
    perByte[byteIndex] = contributions
  }
  return perByte
}

const IP_BYTES = buildByteTables(IP)
const FP_BYTES = buildByteTables(FP)

/**
 * Apply a permutation through its byte contributions.
 *
 * The two 64-bit words are XORed separately: combining them into one Number
 * would exceed 2^53 and silently lose the low bits.
 */
function applyByteTable(table, hi, lo) {
  const bytes = [
    (hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff,
    (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff,
  ]
  let outHi = 0
  let outLo = 0
  for (let byteIndex = 0; byteIndex < 8; byteIndex += 1) {
    const contributions = table[byteIndex]
    const value = bytes[byteIndex]
    outHi = (outHi ^ contributions[value * 2]) >>> 0
    outLo = (outLo ^ contributions[value * 2 + 1]) >>> 0
  }
  return { hi: outHi, lo: outLo }
}

/** Fold the S-boxes through P so a round becomes eight table lookups. */
const SP = (() => {
  const sp = new Array(8)
  for (let box = 0; box < 8; box += 1) {
    const entries = new Uint32Array(64)
    for (let input = 0; input < 64; input += 1) {
      const row = ((input & 0x20) >>> 4) | (input & 1)
      const column = (input >>> 1) & 0x0f
      const value = SBOXES[box][row * 16 + column]
      // S-box output nibble sits at the most significant end for box 0.
      const positioned = (value * 2 ** (28 - box * 4)) >>> 0
      entries[input] = permute32(positioned, P)
    }
    sp[box] = entries
  }
  return sp
})()

/** E expansion folded per input byte: 48 bits held exactly in a JS number. */
const E_BYTES = (() => {
  const table = new Array(4)
  for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
    const entries = new Float64Array(256)
    for (let value = 0; value < 256; value += 1) {
      let expanded = 0
      for (let bit = 0; bit < 8; bit += 1) {
        if (((value >>> (7 - bit)) & 1) === 0) continue
        const bitNumber = byteIndex * 8 + bit + 1
        for (let out = 0; out < 48; out += 1) {
          if (E[out] === bitNumber) expanded += 2 ** (47 - out)
        }
      }
      entries[value] = expanded
    }
    table[byteIndex] = entries
  }
  return table
})()

const SHIFT_POWERS = [2 ** 42, 2 ** 36, 2 ** 30, 2 ** 24, 2 ** 18, 2 ** 12, 2 ** 6, 1]
const TWENTY_FOUR = 2 ** 24

function expand32(value) {
  return (
    E_BYTES[0][(value >>> 24) & 0xff] +
    E_BYTES[1][(value >>> 16) & 0xff] +
    E_BYTES[2][(value >>> 8) & 0xff] +
    E_BYTES[3][value & 0xff]
  )
}

/**
 * One Feistel round.
 *
 * The 48-bit expansion does not fit a JS bitwise operand, so it is split into
 * two 24-bit halves before the XOR with the subkey.
 */
function feistel(right, subkey) {
  const expanded = expand32(right)
  const mixedHi = Math.floor(expanded / TWENTY_FOUR) ^ Math.floor(subkey / TWENTY_FOUR)
  const mixedLo = (expanded % TWENTY_FOUR) ^ (subkey % TWENTY_FOUR)

  let out = 0
  for (let box = 0; box < 4; box += 1) {
    out ^= SP[box][(mixedHi >>> (18 - box * 6)) & 63]
  }
  for (let box = 4; box < 8; box += 1) {
    out ^= SP[box][(mixedLo >>> (18 - (box - 4) * 6)) & 63]
  }
  return out >>> 0
}

/** Build the sixteen 48-bit subkeys for one 64-bit key. */
function buildSubkeys(keyHi, keyLo) {
  const permuted = permute64(keyHi, keyLo, PC1)
  // PC1 yields 56 bits: 32 in hi, 24 in lo. Split 28/28.
  let c = Math.floor(permuted.hi / 2 ** 4)
  let d = ((permuted.hi % 2 ** 4) * 2 ** 24 + permuted.lo) >>> 0

  const subkeys = new Array(16)
  for (let round = 0; round < 16; round += 1) {
    const shift = SHIFTS[round]
    c = ((c << shift) | (c >>> (28 - shift))) & 0x0fffffff
    d = ((d << shift) | (d >>> (28 - shift))) & 0x0fffffff

    // Rejoin to 56 bits: 28+4 in hi, the remaining 24 in lo.
    const combinedHi = (c * 2 ** 4 + Math.floor(d / 2 ** 24)) >>> 0
    const combinedLo = ((d % 2 ** 24) * 2 ** 8) >>> 0
    // PC2 keeps 48 bits: 32 in hi, 16 in lo.
    const selected = permute64(combinedHi, combinedLo, PC2)
    subkeys[round] = selected.hi * 2 ** 16 + selected.lo
  }
  return subkeys
}

/** Decrypt one 8-byte block in place, returning the plaintext bytes. */
function decryptBlock(input, offset, subkeys, out) {
  const hi = ((input[offset] << 24) | (input[offset + 1] << 16) | (input[offset + 2] << 8) | input[offset + 3]) >>> 0
  const lo = ((input[offset + 4] << 24) | (input[offset + 5] << 16) | (input[offset + 6] << 8) | input[offset + 7]) >>> 0

  const initial = applyByteTable(IP_BYTES, hi, lo)
  let left = initial.hi
  let right = initial.lo

  for (let round = 0; round < 16; round += 1) {
    const next = (left ^ feistel(right, subkeys[15 - round])) >>> 0
    left = right
    right = next
  }

  // Final permutation takes R||L, i.e. the halves are swapped.
  const final = applyByteTable(FP_BYTES, right, left)
  out[0] = (final.hi >>> 24) & 0xff
  out[1] = (final.hi >>> 16) & 0xff
  out[2] = (final.hi >>> 8) & 0xff
  out[3] = final.hi & 0xff
  out[4] = (final.lo >>> 24) & 0xff
  out[5] = (final.lo >>> 16) & 0xff
  out[6] = (final.lo >>> 8) & 0xff
  out[7] = final.lo & 0xff
}

/**
 * Decrypt `length` bytes of ECB ciphertext with an 8-byte key.
 *
 * A trailing partial block is left as-is, matching how the XZZ container pads
 * its part payloads.
 *
 * @param {Buffer|Uint8Array} data ciphertext
 * @param {number} offset first ciphertext byte
 * @param {number} length number of ciphertext bytes
 * @param {Buffer|Uint8Array} keyBytes exactly 8 key bytes
 * @returns {Buffer} plaintext of the same length
 */
export function desEcbDecrypt(data, offset, length, keyBytes) {
  if (keyBytes.length !== 8) throw new Error('DES needs an 8-byte key')
  const keyHi = ((keyBytes[0] << 24) | (keyBytes[1] << 16) | (keyBytes[2] << 8) | keyBytes[3]) >>> 0
  const keyLo = ((keyBytes[4] << 24) | (keyBytes[5] << 16) | (keyBytes[6] << 8) | keyBytes[7]) >>> 0
  const subkeys = buildSubkeys(keyHi, keyLo)

  const output = Buffer.alloc(length)
  const block = new Uint8Array(8)
  const wholeBlocks = Math.floor(length / 8)

  for (let index = 0; index < wholeBlocks; index += 1) {
    decryptBlock(data, offset + index * 8, subkeys, block)
    output.set(block, index * 8)
  }
  const tailStart = wholeBlocks * 8
  for (let index = tailStart; index < length; index += 1) output[index] = data[offset + index]

  return output
}

/** The fixed XZZ part-block key. */
export const XZZ_DES_KEY = Buffer.from('dcfc12ac00000000', 'hex')
