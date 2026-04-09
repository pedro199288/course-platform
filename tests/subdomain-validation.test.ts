import { describe, expect, it } from "vite-plus/test";

const SUBDOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RESERVED_SUBDOMAINS = new Set([
  "www",
  "api",
  "app",
  "admin",
  "mail",
  "ftp",
  "blog",
  "shop",
  "store",
  "help",
  "support",
  "status",
  "docs",
  "cdn",
  "assets",
  "static",
  "media",
]);

function validateSubdomain(subdomain: string): { valid: boolean; reason: string | null } {
  if (!SUBDOMAIN_REGEX.test(subdomain)) {
    return { valid: false, reason: "Invalid subdomain format." };
  }
  if (subdomain.length < 3) {
    return { valid: false, reason: "Subdomain must be at least 3 characters." };
  }
  if (RESERVED_SUBDOMAINS.has(subdomain)) {
    return { valid: false, reason: "This subdomain is reserved." };
  }
  return { valid: true, reason: null };
}

describe("subdomain validation", () => {
  it("accepts valid subdomains", () => {
    expect(validateSubdomain("my-school").valid).toBe(true);
    expect(validateSubdomain("school123").valid).toBe(true);
    expect(validateSubdomain("abc").valid).toBe(true);
    expect(validateSubdomain("a1b2c3").valid).toBe(true);
  });

  it("rejects subdomains shorter than 3 chars", () => {
    const result = validateSubdomain("ab");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("at least 3");
  });

  it("rejects subdomains with uppercase letters", () => {
    expect(validateSubdomain("MySchool").valid).toBe(false);
  });

  it("rejects subdomains starting with a hyphen", () => {
    expect(validateSubdomain("-school").valid).toBe(false);
  });

  it("rejects subdomains ending with a hyphen", () => {
    expect(validateSubdomain("school-").valid).toBe(false);
  });

  it("rejects subdomains with special characters", () => {
    expect(validateSubdomain("my_school").valid).toBe(false);
    expect(validateSubdomain("my.school").valid).toBe(false);
    expect(validateSubdomain("my school").valid).toBe(false);
    expect(validateSubdomain("school@1").valid).toBe(false);
  });

  it("rejects reserved subdomains", () => {
    expect(validateSubdomain("www").valid).toBe(false);
    expect(validateSubdomain("api").valid).toBe(false);
    expect(validateSubdomain("admin").valid).toBe(false);
    expect(validateSubdomain("app").valid).toBe(false);
    expect(validateSubdomain("mail").valid).toBe(false);
    expect(validateSubdomain("cdn").valid).toBe(false);
    expect(validateSubdomain("docs").valid).toBe(false);
    expect(validateSubdomain("support").valid).toBe(false);
  });

  it("accepts non-reserved subdomains", () => {
    expect(validateSubdomain("my-blog").valid).toBe(true);
    expect(validateSubdomain("the-api").valid).toBe(true);
    expect(validateSubdomain("academy").valid).toBe(true);
  });
});
