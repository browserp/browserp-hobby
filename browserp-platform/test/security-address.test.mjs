import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { securityContext, securityFingerprintContext, unsealAddress } from "../lib/security.js";
import { clientSignal } from "../lib/http.js";

function response() {
  const headers = new Map();
  return { getHeader: name => headers.get(name), setHeader: (name, value) => headers.set(name, value) };
}

function withEnvironment(values, callback) {
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    return callback();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

const environment = {
  VERCEL: "1", CLOUDFLARE_PROXY_ENABLED: "1",
  PRIVACY_HASH_SECRET: "test-privacy-secret", NETWORK_EVIDENCE_KEY: "11".repeat(32)
};
const cloudflareHeaders = {
  host: "www.browserp.com", "cf-ray": "8f1234567890abcd-LHR",
  "cf-connecting-ip": "198.51.100.44"
};
function address(headers = {}, peer = "203.0.113.77") {
  const evidence = securityContext({ headers, socket: { remoteAddress: peer } }, response());
  return evidence.networkCiphertext ? unsealAddress(evidence.networkCiphertext) : "unknown";
}

test("direct-origin callers cannot spoof their address with Cloudflare or ordinary forwarded headers", () => {
  withEnvironment(environment, () => {
    for (const direct of ["203.0.113.10", "2001:db8::10", "::FFFF:203.0.113.10", "0:0:0:0:0:ffff:cb00:710a"]) {
      const actual = address({ ...cloudflareHeaders, "x-forwarded-host": "www.browserp.com", "x-vercel-forwarded-for": direct, "x-forwarded-for": "198.51.100.45", "x-real-ip": "198.51.100.46" });
      assert.equal(actual, direct.includes("2001:") ? "2001:db8::10" : "203.0.113.10");
    }
  });
});

test("Cloudflare IPv4 and IPv6 edge ingress may supply the verified client address", () => {
  withEnvironment(environment, () => {
    for (const edge of ["173.245.48.1", "104.16.0.1", "172.71.255.254", "2606:4700::1", "2a06:98c7:ffff::1", "::ffff:104.16.0.1", "0:0:0:0:0:ffff:6810:1"]) {
      assert.equal(address({ ...cloudflareHeaders, "x-vercel-forwarded-for": edge }), "198.51.100.44", edge);
    }
    assert.equal(address({ ...cloudflareHeaders, "x-vercel-forwarded-for": "104.16.0.1", "cf-connecting-ip": "2001:DB8:0:0::44" }), "2001:db8::44");
    assert.equal(address({ ...cloudflareHeaders, "x-vercel-forwarded-for": "2606:4700::1", "cf-connecting-ip": "0:0:0:0:0:ffff:c633:642c" }), "198.51.100.44");
  });
});

test("nearby addresses outside Cloudflare CIDRs do not establish trusted ingress", () => {
  withEnvironment(environment, () => {
    for (const outside of ["173.245.47.255", "173.245.64.0", "104.15.255.255", "104.28.0.1", "172.72.0.1", "2606:4701::1", "2a06:98c8::1"]) {
      assert.equal(address({ ...cloudflareHeaders, "x-vercel-forwarded-for": outside }), outside);
    }
  });
});

test("Vercel Verified Proxy's already-corrected visitor address remains authoritative", () => {
  withEnvironment(environment, () => {
    assert.equal(address({ ...cloudflareHeaders, "x-vercel-forwarded-for": "198.51.100.66", "cf-connecting-ip": "198.51.100.99" }), "198.51.100.66");
    assert.equal(address({ "x-vercel-forwarded-for": "2001:db8::66" }), "2001:db8::66");
    assert.equal(address({ "x-vercel-forwarded-for": "::ffff:0:0:1" }), "::ffff:0:0:1", "a shared prefix does not make an IPv6 address IPv4-mapped");
  });
});

test("malformed, duplicate and absent Cloudflare client headers keep the proven ingress address", () => {
  withEnvironment(environment, () => {
    for (const value of [undefined, "", "not-an-ip", "198.51.100.44, 198.51.100.45", ["198.51.100.44"], "198.51.100.44:443", "[2001:db8::1]", "fe80::1%eth0", "x".repeat(1000)]) {
      assert.equal(address({ ...cloudflareHeaders, "x-vercel-forwarded-for": "104.16.0.1", "cf-connecting-ip": value }), "104.16.0.1");
    }
  });
});

test("missing or malformed Vercel ingress cannot promote untrusted header fallbacks", () => {
  withEnvironment(environment, () => {
    for (const ingress of [undefined, "", "invalid", "104.16.0.1, 203.0.113.10", ["104.16.0.1"], "fe80::1%eth0"]) {
      assert.equal(address({ ...cloudflareHeaders, "x-vercel-forwarded-for": ingress, "x-forwarded-for": "104.16.0.1", "x-real-ip": "198.51.100.99" }), "203.0.113.77");
    }
    assert.equal(address({ ...cloudflareHeaders }, null), "unknown");
    assert.equal(address({ ...cloudflareHeaders }, "bad-peer"), "unknown");
  });
});

test("outside Vercel only the socket peer can identify the caller", () => {
  withEnvironment({ ...environment, VERCEL: undefined }, () => {
    const headers = { ...cloudflareHeaders, "x-vercel-forwarded-for": "104.16.0.1", "x-forwarded-for": "198.51.100.99", "x-real-ip": "198.51.100.88" };
    assert.equal(address(headers), "203.0.113.77");
    assert.equal(address(headers, "::ffff:203.0.113.77"), "203.0.113.77");
    assert.equal(address(headers, "104.16.0.1"), "104.16.0.1", "the opt-in flag alone does not prove local reverse-proxy ownership");
  });
});

test("Cloudflare client override retains the explicit host, proxy and Ray conditions", () => {
  withEnvironment(environment, () => {
    assert.equal(address({ ...cloudflareHeaders, host: "browserp-hobby.vercel.app", "x-vercel-forwarded-for": "104.16.0.1" }), "104.16.0.1");
    assert.equal(address({ ...cloudflareHeaders, "cf-ray": "forged", "x-vercel-forwarded-for": "104.16.0.1" }), "104.16.0.1");
  });
  withEnvironment({ ...environment, CLOUDFLARE_PROXY_ENABLED: "0" }, () => {
    assert.equal(address({ ...cloudflareHeaders, "x-vercel-forwarded-for": "104.16.0.1" }), "104.16.0.1");
  });
});

test("equivalent IPv6 and mapped IPv4 representations share the security fingerprint", () => {
  withEnvironment(environment, () => {
    const hash = value => securityFingerprintContext({ headers: { "x-vercel-forwarded-for": value } }, response()).networkHash;
    assert.equal(hash("2001:0DB8:0:0:0:0:0:1"), hash("2001:db8::1"));
    assert.equal(hash("0:0:0:0:0:ffff:c633:642c"), hash("198.51.100.44"));
  });
});

test("rate-limit identity uses the same authoritative address and cannot be rotated with spoofed headers", () => {
  const expected = value => createHmac("sha256", environment.PRIVACY_HASH_SECRET).update(value).digest("hex");
  withEnvironment(environment, () => {
    for (const spoof of ["198.51.100.1", "198.51.100.2", "2001:db8::1"]) {
      const headers = { ...cloudflareHeaders, "cf-connecting-ip": spoof, "x-forwarded-for": spoof, "x-real-ip": spoof, "x-vercel-forwarded-for": "203.0.113.10" };
      assert.equal(clientSignal({ headers }), expected("203.0.113.10"));
    }
    assert.equal(clientSignal({ headers: { ...cloudflareHeaders, "x-vercel-forwarded-for": "104.16.0.1" } }), expected("198.51.100.44"));
    assert.equal(clientSignal({ headers: { "x-vercel-forwarded-for": "0:0:0:0:0:ffff:cb00:710a" } }), expected("203.0.113.10"));
    assert.equal(clientSignal({ headers: { "x-vercel-forwarded-for": "invalid", "x-forwarded-for": "198.51.100.99" }, socket: { remoteAddress: "203.0.113.77" } }), expected("203.0.113.77"));
  });
  withEnvironment({ ...environment, VERCEL: undefined }, () => {
    const headers = { ...cloudflareHeaders, "x-vercel-forwarded-for": "104.16.0.1", "x-real-ip": "198.51.100.99" };
    assert.equal(clientSignal({ headers, socket: { remoteAddress: "203.0.113.77" } }), expected("203.0.113.77"));
    assert.equal(clientSignal({ headers }), expected("unknown"));
  });
});
