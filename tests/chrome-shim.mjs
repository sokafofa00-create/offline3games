import { chromium } from "playwright";
const orig = chromium.launch.bind(chromium);
chromium.launch = (opts = {}) => orig({ ...opts, channel: "chrome" });
