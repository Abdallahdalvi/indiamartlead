/**
 * SHA-256 hashing utilities using the Web Crypto API.
 *
 * Works in all extension contexts:
 *   - MV3 service workers  (crypto.subtle is available)
 *   - Content scripts      (window.crypto.subtle is available)
 *   - Popup / Side panel   (standard browser window)
 */

/**
 * Compute a hex-encoded SHA-256 digest of a string.
 */
export async function sha256(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const buffer  = await crypto.subtle.digest('SHA-256', encoded);
  const bytes   = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Normalise a field value for consistent hashing:
 * lowercase → trim → collapse internal whitespace.
 */
function normalise(value: string | null | undefined): string {
  if (!value) return '';
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Compute the canonical Lead ID (SHA-256 hash) for deduplication.
 *
 * Strategy:
 *   Primary  → SHA256("phone|company|product")   when phone is present
 *   Fallback → SHA256("fb:name|company|product")  when phone is absent
 *
 * The "fb:" prefix prevents hash collisions between the two strategies.
 */
export async function computeLeadId(
  mobile:    string | null,
  company:   string | null,
  product:   string | null,
  buyerName?: string | null,
): Promise<string> {
  const nMobile  = normalise(mobile);
  const nCompany = normalise(company);
  const nProduct = normalise(product);

  if (nMobile) {
    return sha256(`${nMobile}|${nCompany}|${nProduct}`);
  }

  // Fallback: use buyer name
  const nName = normalise(buyerName);
  return sha256(`fb:${nName}|${nCompany}|${nProduct}`);
}
