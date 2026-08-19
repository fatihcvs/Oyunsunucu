import assert from "node:assert/strict";
import test from "node:test";
import {
  GAME_RUNTIMES,
  findGameRuntime,
  heapMegabytes,
  missingRuntimeCombinations,
  offHeapReserveMegabytes,
} from "../infra/gameservers/runtime-catalog.ts";
import {
  ACTIVE_GAMES,
  DEFAULT_SERVER_DRAFT,
  GAME_CATALOG,
  HOSTING_PLANS,
  isServerDraft,
  sellableSoftware,
} from "../lib/catalog.ts";

test("every sellable game and software has a runtime definition", () => {
  assert.deepEqual(missingRuntimeCombinations(), []);
});

test("nothing a customer can order is missing a runtime image", () => {
  // A software option stays behind `soon` until an image is pinned for it;
  // otherwise the store would take an order for a server we cannot create.
  for (const game of ACTIVE_GAMES) {
    for (const software of sellableSoftware(game)) {
      const runtime = findGameRuntime(game.id, software.id);
      assert.ok(runtime, `${game.id}/${software.id} çalışma ortamı yok`);
      assert.notEqual(
        runtime.verification,
        "unresolved",
        `${game.id}/${software.id} imajı çözülmeden satışa açık`,
      );
      assert.ok(runtime.image, `${game.id}/${software.id} imajsız satışa açık`);
    }
  }
});

test("a draft cannot order a software option the store does not sell", () => {
  const terraria = ACTIVE_GAMES.find((game) => game.id === "terraria");
  const announced = terraria.software.find((software) => software.soon);
  assert.ok(announced, "beklenen 'yakında' yazılımı katalogda yok");

  assert.equal(isServerDraft({ ...DEFAULT_SERVER_DRAFT, gameId: "terraria", softwareId: announced.id }), false);
  assert.equal(isServerDraft({ ...DEFAULT_SERVER_DRAFT, gameId: "minecraft", softwareId: "bilinmeyen" }), false);
  assert.equal(isServerDraft(DEFAULT_SERVER_DRAFT), true);
});

test("a resolved runtime is pinned by version tag or digest, never by a floating tag", () => {
  for (const runtime of GAME_RUNTIMES) {
    const label = `${runtime.gameId}/${runtime.softwareId}`;
    if (runtime.verification === "unresolved") {
      assert.equal(runtime.image, null, `${label} çözülmemişken imaj taşıyor`);
      continue;
    }

    assert.ok(runtime.image, `${label} imajsız`);
    if (runtime.image.includes("@sha256:")) {
      assert.match(runtime.image, /@sha256:[a-f0-9]{64}$/, `${label} bozuk digest kullanıyor`);
      continue;
    }

    const tag = runtime.image.split(":")[1];
    assert.ok(tag, `${label} etiketsiz imaj kullanıyor`);
    assert.notEqual(tag, "latest", `${label} kayan bir etikete bağlı`);
  }
});

test("only TCP runtimes back a sellable game while Railway is the only provider", () => {
  for (const runtime of GAME_RUNTIMES) {
    assert.equal(
      runtime.protocol,
      "TCP",
      `${runtime.gameId}/${runtime.softwareId} UDP; ikinci sağlayıcı gelmeden satılamaz`,
    );
  }
});

test("no runtime is offered below the memory it declares it needs", () => {
  const smallestPlanMb = Math.min(...HOSTING_PLANS.map((plan) => plan.ram)) * 1024;

  for (const runtime of GAME_RUNTIMES) {
    assert.ok(
      runtime.minimumMemoryMb >= smallestPlanMb,
      `${runtime.gameId}/${runtime.softwareId} en küçük planın altında bir sınır bildiriyor`,
    );
    assert.ok(
      HOSTING_PLANS.some((plan) => plan.ram * 1024 >= runtime.minimumMemoryMb),
      `${runtime.gameId}/${runtime.softwareId} hiçbir planla karşılanamıyor`,
    );
  }
});

test("only combinations proven on a real container are marked certified", () => {
  const certified = GAME_RUNTIMES
    .filter((runtime) => runtime.verification === "certified")
    .map((runtime) => `${runtime.gameId}/${runtime.softwareId}`)
    .sort();

  // Updated only when scripts/certify-game-runtime.mjs reports `certified` and
  // docs/GAME_RUNTIME_CERTIFICATION.md records the measurement.
  assert.deepEqual(certified, [
    "minecraft/fabric",
    "minecraft/paper",
    "minecraft/purpur",
    "minecraft/vanilla",
    "terraria/terraria-vanilla",
    "vintagestory/vintagestory-vanilla",
  ]);
});

test("a game is only sellable when the store can host it today", () => {
  for (const game of GAME_CATALOG) {
    if (!game.live) continue;
    assert.equal(game.protocol, "TCP", `${game.id} UDP protokolüyle canlı işaretlenmiş`);
    assert.ok(game.software.length > 0, `${game.id} canlı ama yazılım seçeneği yok`);
  }
});

test("the recommended software of each live game resolves to a runtime", () => {
  for (const game of ACTIVE_GAMES) {
    const sellable = sellableSoftware(game);
    const recommended = sellable.find((software) => software.recommended) ?? sellable[0];
    assert.notEqual(findGameRuntime(game.id, recommended.id), null);
  }
});

test("heap leaves the measured off-heap reserve on every plan", () => {
  for (const plan of HOSTING_PLANS) {
    const limit = plan.ram * 1024;
    const heap = heapMegabytes(limit);
    assert.ok(heap > 0, `${plan.id} için heap kalmıyor`);
    assert.equal(limit - heap, offHeapReserveMegabytes(limit));
    // The 2 GB measurement showed ~500 MB of JVM overhead beyond the heap.
    assert.ok(limit - heap >= 768, `${plan.id} için off-heap payı ölçülen ihtiyacın altında`);
  }
});
