import { getRequestConfig } from "next-intl/server";

// English only for now; every string still goes through the catalog so languages can be added.
export default getRequestConfig(async () => ({
  locale: "en",
  messages: (await import("../../messages/en.json")).default,
}));
