import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_KEYS,
  checkTemplateEdit,
  renderEmail,
  templateVariables,
} from "./templates";

describe("renderEmail", () => {
  it("fills variables in text and HTML, and renders the button", () => {
    const out = renderEmail(DEFAULT_TEMPLATES.welcome, {
      first_name: "Riya",
      roles: "SDE Intern",
      email: "riya@example.com",
      temp_password: "Kx7m-Pq4t-Wr9z",
      login_url: "https://workspace.isocodelabs.com/login",
    });
    expect(out.subject).toBe(
      "You're shortlisted for SDE Intern at Isocode Labs: your workspace login",
    );
    expect(out.text).toContain("Temporary password: Kx7m-Pq4t-Wr9z");
    expect(out.text).toContain("Sign in to the workspace: https://workspace.isocodelabs.com/login");
    expect(out.html).toContain('href="https://workspace.isocodelabs.com/login"');
  });

  it("escapes values so candidate-controlled text can't inject HTML", () => {
    const out = renderEmail(
      { subject: "Hi {{first_name}}", body: "Hello {{first_name}}" },
      {
        first_name: '<img src=x onerror="alert(1)">',
      },
    );
    expect(out.html).not.toContain("<img src=x"); // the header image is ours; the injected tag must be escaped
    expect(out.html).toContain("&lt;img");
  });

  it("drops buttons whose link isn't http(s)", () => {
    const out = renderEmail(
      { subject: "x", body: "[[button:Go|{{u}}]]" },
      { u: "javascript:alert(1)" },
    );
    expect(out.html).not.toContain("javascript:");
  });

  it("keeps the subject on one line", () => {
    expect(
      renderEmail({ subject: "Hi {{n}}", body: "x" }, { n: "A\r\nBcc: evil@x.com" }).subject,
    ).toBe("Hi A Bcc: evil@x.com");
  });
});

describe("template rules", () => {
  it("has a default for every key", () => {
    for (const key of TEMPLATE_KEYS) expect(DEFAULT_TEMPLATES[key].body.length).toBeGreaterThan(20);
  });

  it("only allows the temporary password in the welcome email", () => {
    expect(checkTemplateEdit("welcome", "Hi", "Password: {{temp_password}}")).toBeNull();
    expect(checkTemplateEdit("role_added", "Hi", "Password: {{temp_password}}")).toMatch(
      /can't be used/,
    );
    expect(checkTemplateEdit("welcome", "Your password {{temp_password}}", "x")).toMatch(/subject/);
  });

  it("lists the variables a template uses", () => {
    expect(templateVariables("Hi {{first_name}}, see {{ login_url }} {{first_name}}")).toEqual([
      "first_name",
      "login_url",
    ]);
  });
});
