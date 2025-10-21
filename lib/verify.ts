import nacl from 'tweetnacl';

export async function verifyDiscordRequest(req: Request): Promise<{ valid: boolean; body: string }> {
  const body = await req.text();
  const signature = req.headers.get('X-Signature-Ed25519') ?? '';
  const timestamp = req.headers.get('X-Signature-Timestamp') ?? '';
  const publicKeyHex = process.env.DISCORD_PUBLIC_KEY ?? '';
  if (!signature || !timestamp || !publicKeyHex) {
    return { valid: false, body };
  }
  const message = new TextEncoder().encode(timestamp + body);
  const sig = hexToUint8Array(signature);
  const pub = hexToUint8Array(publicKeyHex);
  const ok = nacl.sign.detached.verify(message, sig, pub);
  return { valid: ok, body };
}

function hexToUint8Array(hex: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(hex, 'hex'));
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}


