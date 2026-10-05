import { describe, expect, it } from "vitest";
import { lanOrigin, pickLanAddress, type Interfaces } from "../../../vite.config";

const wifi = { address: "192.168.1.20", family: "IPv4", internal: false };

describe("the computer's address on the network", () => {
  it("is the Wi-Fi's, not the loopback or an IPv6 one", () => {
    const interfaces: Interfaces = {
      lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      en0: [{ address: "fe80::1", family: "IPv6", internal: false }, wifi],
    };
    expect(pickLanAddress(interfaces)).toBe("192.168.1.20");
    expect(lanOrigin(interfaces, 5190)).toBe("https://192.168.1.20:5190");
    expect(lanOrigin(interfaces, 5190, false)).toBe("http://192.168.1.20:5190");
  });

  it("prefers a home router's range to a VPN's or a virtual machine's", () => {
    const interfaces: Interfaces = {
      utun3: [{ address: "100.64.0.9", family: "IPv4", internal: false }],
      bridge100: [{ address: "172.20.0.1", family: "IPv4", internal: false }],
      en1: [{ address: "10.0.0.5", family: "IPv4", internal: false }],
      en0: [wifi],
    };
    expect(pickLanAddress(interfaces)).toBe("192.168.1.20");
    delete interfaces.en0;
    expect(pickLanAddress(interfaces)).toBe("10.0.0.5");
    delete interfaces.en1;
    expect(pickLanAddress(interfaces)).toBe("172.20.0.1");
  });

  it("reads the family as a number too (newer Node), and gives up on a computer with no network", () => {
    expect(pickLanAddress({ en0: [{ address: "192.168.0.7", family: 4, internal: false }] })).toBe("192.168.0.7");
    expect(pickLanAddress({ lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }] })).toBeNull();
    expect(pickLanAddress({ en0: [{ address: "169.254.3.3", family: "IPv4", internal: false }, wifi] })).toBe("192.168.1.20");
    expect(pickLanAddress({})).toBeNull();
    expect(lanOrigin({}, 5190)).toBeNull();
  });

  it("chooses the same one every time", () => {
    const a: Interfaces = { en5: [{ address: "192.168.2.2", family: "IPv4", internal: false }], en0: [wifi] };
    expect(pickLanAddress(a)).toBe("192.168.1.20");
  });
});
