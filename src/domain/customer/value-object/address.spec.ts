import Address from "./address";

describe("Address unit tests", () => {
  it("should throw error when street is empty", () => {
    expect(() => {
      new Address("", 123, "13330-250", "New York");
    }).toThrow("Street is required");
  });

  it("should throw error when number is zero or negative", () => {
    expect(() => {
      new Address("Street", 0, "13330-250", "New York");
    }).toThrow("Number must be greater than zero");

    expect(() => {
      new Address("Street", -1, "13330-250", "New York");
    }).toThrow("Number must be greater than zero");
  });

  it("should throw error when zip is empty", () => {
    expect(() => {
      new Address("Street", 123, "", "New York");
    }).toThrow("Zip is required");
  });

  it("should throw error when city is empty", () => {
    expect(() => {
      new Address("Street", 123, "13330-250", "");
    }).toThrow("City is required");
  });

  it("should create a valid address", () => {
    const address = new Address("Street 1", 123, "13330-250", "New York");

    expect(address.street).toBe("Street 1");
    expect(address.number).toBe(123);
    expect(address.zip).toBe("13330-250");
    expect(address.city).toBe("New York");
  });

  it("should return formatted address as string", () => {
    const address = new Address("Main Street", 123, "12345-678", "New York");

    expect(address.toString()).toBe("Main Street, 123, 12345-678 New York");
  });
});
