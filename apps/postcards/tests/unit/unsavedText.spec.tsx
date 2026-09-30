import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CityScreen } from "../../src/features/city/CityScreen";
import { PhotoGallery } from "../../src/features/visits/PhotoGallery";
import { useVisits } from "../../src/lib/store/useVisits";

// Text typed into a field that saves on blur must also be saved when the field
// goes away without a blur: Escape, Back, a closed dialog.

const SH = { kind: "city", id: "1796236", name: "Shanghai", countryId: "CN" } as const;
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

afterEach(cleanup);

it("a city note left by Escape or Back is saved", () => {
  const setDetails = vi.fn(async () => {});
  useVisits.setState({
    visits: [
      {
        visitId: "v1",
        place: SH,
        status: "visited",
        favorite: false,
        date: null,
        note: null,
        addedAt: "x",
        updatedAt: "x",
      },
    ],
    setDetails,
  });
  const page = render(<CityScreen cityId="1796236" onBack={() => {}} />);
  const note = document.querySelector("textarea")!;
  note.focus();
  fireEvent.change(note, { target: { value: "Night view from the Bund" } });
  page.unmount(); // App's Escape or Back closes the page with the note still focused
  expect(setDetails).toHaveBeenCalledWith("v1", { note: "Night view from the Bund" });
});

it("a city note already saved on blur is not written again on leaving", () => {
  const setDetails = vi.fn(async () => {});
  useVisits.setState({
    visits: [
      {
        visitId: "v1",
        place: SH,
        status: "visited",
        favorite: false,
        date: null,
        note: null,
        addedAt: "x",
        updatedAt: "x",
      },
    ],
    setDetails,
  });
  const page = render(<CityScreen cityId="1796236" onBack={() => {}} />);
  const note = document.querySelector("textarea")!;
  fireEvent.change(note, { target: { value: "Bund" } });
  fireEvent.blur(note);
  page.unmount();
  expect(setDetails).toHaveBeenCalledTimes(1);
});

it("a photo caption left by Escape is saved", () => {
  const setPhotoCaption = vi.fn(async () => {});
  useVisits.setState({ setPhotoCaption });
  render(<PhotoGallery visitId="v1" photos={[{ src: PNG, caption: null }]} placeName="Shanghai" />);
  fireEvent.click(screen.getByRole("button", { name: /View 1 photo/ }));
  const caption = screen.getByRole("textbox", { name: /Caption for photo 1/ });
  caption.focus();
  fireEvent.change(caption, { target: { value: "The Bund at night" } });
  fireEvent.keyDown(caption, { key: "Escape" });
  expect(setPhotoCaption).toHaveBeenCalledWith("v1", 0, "The Bund at night");
});
