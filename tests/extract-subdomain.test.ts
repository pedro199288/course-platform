import { describe, expect, it } from "vite-plus/test";
import { extractSubdomain } from "#/middleware/tenant.ts";

describe("extractSubdomain", () => {
  it("extracts subdomain from tenant.localhost", () => {
    expect(extractSubdomain("myschool.localhost")).toBe("myschool");
  });

  it("extracts subdomain from tenant.localhost:3000", () => {
    expect(extractSubdomain("myschool.localhost:3000")).toBe("myschool");
  });

  it("returns null for bare localhost", () => {
    expect(extractSubdomain("localhost")).toBeNull();
  });

  it("returns null for localhost:3000", () => {
    expect(extractSubdomain("localhost:3000")).toBeNull();
  });

  it("extracts subdomain from tenant.platform.com", () => {
    expect(extractSubdomain("myschool.platform.com")).toBe("myschool");
  });

  it("extracts subdomain from tenant.platform.com:443", () => {
    expect(extractSubdomain("myschool.platform.com:443")).toBe("myschool");
  });

  it("returns null for bare platform.com", () => {
    expect(extractSubdomain("platform.com")).toBeNull();
  });

  it("returns null for www.platform.com", () => {
    expect(extractSubdomain("www.platform.com")).toBeNull();
  });

  it("returns null for www.localhost", () => {
    expect(extractSubdomain("www.localhost")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractSubdomain("")).toBeNull();
  });

  it("handles deeply nested subdomains", () => {
    expect(extractSubdomain("myschool.us.platform.com")).toBe("myschool");
  });
});
