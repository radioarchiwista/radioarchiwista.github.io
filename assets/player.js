(function () {
  const pageRoot = document.querySelector(".player-page");
  const stationFilterInput = document.getElementById("player-station-filter");
  const stationSelect = document.getElementById("player-station");
  const yearSelect = document.getElementById("player-year");
  const monthSelect = document.getElementById("player-month");
  const daySelect = document.getElementById("player-day");
  const hourSelect = document.getElementById("player-hour");
  const loadButton = document.getElementById("player-load-button");
  const statusNode = document.getElementById("player-status");
  const titleNode = document.getElementById("player-title");
  const subtitleNode = document.getElementById("player-subtitle");
  const audio = document.getElementById("archive-audio");
  const playButton = document.getElementById("player-play-button");
  const backButton = document.getElementById("player-back-button");
  const forwardButton = document.getElementById("player-forward-button");
  const rateSelect = document.getElementById("player-rate");
  const seekInput = document.getElementById("player-seek");
  const currentTimeNode = document.getElementById("player-current-time");
  const durationNode = document.getElementById("player-duration");
  const downloadLink = document.getElementById("player-download-link");
  const fragmentDownloadGroup = document.getElementById("player-fragment-download-group");
  const fragmentStartMinuteInput = document.getElementById("player-fragment-start-minute");
  const fragmentEndMinuteInput = document.getElementById("player-fragment-end-minute");
  const fragmentDownloadButton = document.getElementById("player-fragment-download-button");
  const outputDeviceGroup = document.getElementById("player-output-device-group");
  const outputDeviceSelect = document.getElementById("player-output-device");
  const outputDeviceChooser = document.getElementById("player-output-device-chooser");
  const outputDeviceReset = document.getElementById("player-output-device-reset");
  const outputDeviceCurrentNode = document.getElementById("player-output-device-current");
  const outputDeviceStatusNode = document.getElementById("player-output-device-status");
  const stationCountNode = document.getElementById("player-station-count");
  const snapshotMetaNode = document.getElementById("player-snapshot-meta");
  const emptyStateNode = document.getElementById("player-empty-state");
  const loadedStateNode = document.getElementById("player-loaded-state");
  const seekStepSeconds = 15;
  const youtubeSeekStepSeconds = 10;
  const localAudioCacheName = "radio-archiwista-player-audio-v1";
  const maxLocalAudioCacheEntries = 2;
  const displayTimeZone = "Europe/Warsaw";
  const stationsEndpoint =
    pageRoot?.dataset.playerStationsEndpoint || "/player/api/stations";
  const stationIndexUrlTemplate =
    pageRoot?.dataset.playerStationIndexTemplate || "";
  const yearIndexUrlTemplate =
    pageRoot?.dataset.playerYearIndexTemplate || "";
  const monthIndexUrlTemplate =
    pageRoot?.dataset.playerMonthIndexTemplate || "";
  const dayCatalogUrlTemplate =
    pageRoot?.dataset.playerDayCatalogTemplate || "";
  const catalogUrlTemplate =
    pageRoot?.dataset.playerCatalogUrlTemplate || "/player/api/stations/{slug}/catalog";
  const fragmentDownloadUrlTemplate =
    pageRoot?.dataset.playerFragmentDownloadTemplate || "";
  const hierarchicalCatalogEnabled =
    Boolean(stationIndexUrlTemplate) &&
    Boolean(yearIndexUrlTemplate) &&
    Boolean(monthIndexUrlTemplate) &&
    Boolean(dayCatalogUrlTemplate);
  const initialSelection = parseInitialSelection();

  if (
    !stationSelect ||
    !yearSelect ||
    !monthSelect ||
    !daySelect ||
    !hourSelect ||
    !loadButton ||
    !statusNode ||
    !titleNode ||
    !subtitleNode ||
    !audio ||
    !playButton ||
    !backButton ||
    !forwardButton ||
    !rateSelect ||
    !seekInput ||
    !currentTimeNode ||
    !durationNode ||
    !downloadLink ||
    !emptyStateNode ||
    !loadedStateNode
  ) {
    return;
  }

  let stationCatalog = null;
  let currentYearIndex = null;
  let currentMonthIndex = null;
  let currentDayCatalog = null;
  let selectedArchive = null;
  let selectedHourSlot = null;
  let activePlaybackState = null;
  let allStations = extractStationsFromSelectOptions();
  let catalogVersionToken = "";
  const yearIndexCache = new Map();
  const monthIndexCache = new Map();
  const dayCatalogCache = new Map();
  const derivativeUrlCache = new Map();
  const monthFormatter = new Intl.DateTimeFormat("pl-PL", {
    month: "long",
    timeZone: "UTC",
  });
  const sinkIdStorageKey = "radio-archiwista-player-sink-id";
  const sinkSelectionSupported =
    typeof audio.setSinkId === "function" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.enumerateDevices === "function";
  const sinkPromptSupported =
    sinkSelectionSupported &&
    typeof navigator.mediaDevices.selectAudioOutput === "function";
  const mediaPermissionSupported =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.getUserMedia === "function";
  const outputDeviceRefreshSupported = sinkSelectionSupported || mediaPermissionSupported;
  const fragmentDownloadSupported =
    Boolean(fragmentDownloadGroup) &&
    Boolean(fragmentStartMinuteInput) &&
    Boolean(fragmentEndMinuteInput) &&
    Boolean(fragmentDownloadButton);
  const serverFragmentDownloadSupported = Boolean(fragmentDownloadUrlTemplate);

  if (fragmentDownloadGroup) {
    fragmentDownloadGroup.hidden = !fragmentDownloadSupported;
  }

  stationSelect.addEventListener("change", async () => {
    resetArchiveSelection();
    const slug = stationSelect.value;
    syncUrlState();
    if (!slug) {
      setStatus("Wybierz stację, aby załadować katalog godzin.");
      return;
    }

    await loadStationCatalog(slug);
  });

  stationFilterInput?.addEventListener("input", () => {
    applyStationFilter();
  });

  fragmentStartMinuteInput?.addEventListener("input", syncFragmentDownloadState);
  fragmentEndMinuteInput?.addEventListener("input", syncFragmentDownloadState);
  fragmentDownloadButton?.addEventListener("click", async () => {
    if (!selectedArchive) {
      return;
    }
    await triggerArchiveFragmentDownload(selectedArchive);
  });

  yearSelect.addEventListener("change", async () => {
    await handleYearChange();
    syncUrlState();
  });

  monthSelect.addEventListener("change", async () => {
    await handleMonthChange();
    syncUrlState();
  });

  daySelect.addEventListener("change", async () => {
    await handleDayChange();
    syncUrlState();
  });

  hourSelect.addEventListener("change", () => {
    syncSelectedArchive();
    syncUrlState();
  });

  loadButton.addEventListener("click", () => {
    if (!selectedArchive) {
      setStatus("Wybierz konkretną godzinę przed załadowaniem nagrania.");
      return;
    }
    void loadArchiveIntoPlayer(selectedArchive);
  });

  downloadLink.addEventListener("click", async (event) => {
    if (!selectedArchive || downloadLink.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      setStatus("Najpierw załaduj godzinę do pobrania.");
      return;
    }
    event.preventDefault();
    await triggerArchiveDownload(selectedArchive);
  });

  outputDeviceSelect?.addEventListener("change", async () => {
    const nextSinkId = normalizeSinkId(outputDeviceSelect.value);
    await applyAudioOutputDevice(nextSinkId);
  });

  outputDeviceChooser?.addEventListener("click", async () => {
    await promptForAudioOutputDevice();
  });

  outputDeviceReset?.addEventListener("click", async () => {
    if (!outputDeviceSelect) {
      return;
    }
    outputDeviceSelect.value = "default";
    await applyAudioOutputDevice("default");
  });

  playButton.addEventListener("click", async () => {
    if (!audio.src) {
      setStatus("Najpierw załaduj godzinę do odtworzenia.");
      return;
    }
    await togglePlayback();
  });

  backButton.addEventListener("click", () => {
    seekBySeconds(-seekStepSeconds);
  });

  forwardButton.addEventListener("click", () => {
    seekBySeconds(seekStepSeconds);
  });

  rateSelect.addEventListener("change", () => {
    const nextRate = Number(rateSelect.value);
    audio.playbackRate = Number.isFinite(nextRate) ? nextRate : 1;
  });

  seekInput.addEventListener("input", () => {
    if (!Number.isFinite(audio.duration)) {
      return;
    }
    audio.currentTime = Number(seekInput.value);
  });

  audio.addEventListener("loadedmetadata", () => {
    seekInput.disabled = false;
    seekInput.max = String(Math.floor(audio.duration || 0));
    durationNode.textContent = formatDuration(audio.duration);
    updateTimeReadout();
  });

  audio.addEventListener("timeupdate", () => {
    updateTimeReadout();
  });

  audio.addEventListener("play", () => {
    playButton.textContent = "Pauza";
  });

  audio.addEventListener("pause", () => {
    playButton.textContent = "Odtwórz";
  });

  audio.addEventListener("ended", () => {
    playButton.textContent = "Odtwórz";
  });

  audio.addEventListener("error", () => {
    void handleAudioPlaybackError();
  });

  if (navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === "function") {
    navigator.mediaDevices.addEventListener("devicechange", () => {
      void refreshAudioOutputDevices();
    });
  }

  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || !audio.src) {
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || isShortcutSuppressedTarget(event.target)) {
      return;
    }
    const digit = extractDigitShortcut(event);
    if (digit !== null) {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      seekToPercent(digit * 10);
      return;
    }

    const key = event.key.toLowerCase();
    if (!["j", "k", "l", "m"].includes(key)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (key === "j") {
      seekBySeconds(-youtubeSeekStepSeconds);
      setStatus("Przewinięto o 10 sekund w tył.");
      return;
    }
    if (key === "l") {
      seekBySeconds(youtubeSeekStepSeconds);
      setStatus("Przewinięto o 10 sekund do przodu.");
      return;
    }
    if (key === "k") {
      void togglePlayback();
      return;
    }
    toggleMute();
  }, { capture: true });

  async function loadStationCatalog(slug, options = {}) {
    const { preferCurrentDate = true } = options;
    setStatus(`Ładuję katalog dla ${slug}...`);
    clearDependentCatalogState();
    try {
      stationCatalog = hierarchicalCatalogEnabled
        ? await fetchJson(buildTemplateUrl(stationIndexUrlTemplate, { slug }))
        : await fetchJson(buildCatalogUrl(slug));
    } catch (error) {
      stationCatalog = null;
      setStatus(`Nie udało się pobrać katalogu archiwum: ${error}`);
      clearSelect(yearSelect, "Wybierz rok", true);
      clearSelect(monthSelect, "Wybierz miesiąc", true);
      clearSelect(daySelect, "Wybierz dzień", true);
      clearSelect(hourSelect, "Wybierz godzinę", true);
      return;
    }

    populateYearOptions({ preferCurrentDate });
    if (hierarchicalCatalogEnabled) {
      await handleYearChange({ preferCurrentDate });
    } else {
      populateMonthOptions({ preferCurrentDate });
      populateDayOptions({ preferCurrentDate });
      populateHourOptions();
    }
    const archiveCount = stationCatalog?.station?.archive_count ?? stationCatalog?.archives?.length ?? 0;
    setStatus(
      `Załadowano ${archiveCount} godzin dla ${stationCatalog.station.display_name}.`,
    );
  }

  async function loadStationIndex() {
    const fallbackStationCount = Math.max(allStations.length, stationSelect.options.length - 1, 0);
    updateStationCount(fallbackStationCount);
    try {
      const response = await fetch(withRuntimeNoCache(stationsEndpoint), {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      setCatalogVersionToken(
        payload.published_at || payload.generated_at || payload.latest_archive_hour_started_at || "",
      );
      const stations = Array.isArray(payload.stations) ? payload.stations : [];
      populateStationOptions(stations);
      updateStationCount(stations.length);
      updateSnapshotMeta(
        payload.published_at || payload.generated_at || null,
        payload.latest_archive_hour_started_at || null,
        Array.isArray(payload.latest_archive_hour_stations)
          ? payload.latest_archive_hour_stations
          : [],
        Number.isFinite(Number(payload.latest_archive_hour_expected_station_count))
          ? Number(payload.latest_archive_hour_expected_station_count)
          : stations.length,
      );
      if (stations.length === 0) {
        setStatus("Brak opublikowanych godzin do odsłuchu.");
      }
      return true;
    } catch (error) {
      if (fallbackStationCount > 0) {
        if (allStations.length === 0) {
          allStations = extractStationsFromSelectOptions();
          applyStationFilter();
        }
        updateSnapshotMeta(null, null, [], fallbackStationCount);
        setStatus("Nie udało się odświeżyć listy stacji. Używam danych wstępnych.");
        return true;
      }
      clearSelect(stationSelect, "Wybierz stację", true);
      setStatus(`Nie udało się pobrać listy stacji: ${error}`);
      return false;
    }
  }

  function populateStationOptions(stations) {
    if (!Array.isArray(stations) || stations.length === 0) {
      allStations = [];
      clearSelect(stationSelect, "Wybierz stację", true);
      return;
    }
    allStations = stations
      .map((station) => normalizeStationOption(station))
      .filter((station) => station !== null);
    applyStationFilter();
  }

  function populateYearOptions(options = {}) {
    const { preferCurrentDate = false } = options;
    const years = hierarchicalCatalogEnabled
      ? [...(stationCatalog?.years || [])]
      : uniqueValues(stationCatalog.archives.map((archive) => archive.year)).sort(
          (left, right) => right - left,
        );
    fillSelect(yearSelect, years, (year) => ({
      value: String(year),
      label: String(year),
    }));
    if (preferCurrentDate) {
      setSelectToCurrentDatePart(yearSelect, getCurrentStationDateParts().year);
    }
  }

  function populateMonthOptions(options = {}) {
    const { preferCurrentDate = false } = options;
    const selectedYear = Number(yearSelect.value);
    const months = hierarchicalCatalogEnabled
      ? [...(currentYearIndex?.months || [])]
      : uniqueValues(
          filteredArchives().map((archive) => archive.month),
        ).sort((left, right) => left - right);
    if (!selectedYear || months.length === 0) {
      clearSelect(monthSelect, "Wybierz miesiąc", true);
      clearSelect(daySelect, "Wybierz dzień", true);
      clearSelect(hourSelect, "Wybierz godzinę", true);
      return;
    }
    fillSelect(monthSelect, months, (month) => ({
      value: String(month),
      label: formatMonthLabel(month),
    }));
    if (preferCurrentDate && selectedYear === getCurrentStationDateParts().year) {
      setSelectToCurrentDatePart(monthSelect, getCurrentStationDateParts().month);
    }
  }

  function populateDayOptions(options = {}) {
    const { preferCurrentDate = false } = options;
    const selectedYear = Number(yearSelect.value);
    const selectedMonth = Number(monthSelect.value);
    const days = hierarchicalCatalogEnabled
      ? [...(currentMonthIndex?.days || [])]
      : uniqueValues(
          filteredArchives().map((archive) => archive.day),
        ).sort((left, right) => left - right);
    if (!selectedMonth || days.length === 0) {
      clearSelect(daySelect, "Wybierz dzień", true);
      clearSelect(hourSelect, "Wybierz godzinę", true);
      return;
    }
    fillSelect(daySelect, days, (day) => ({
      value: String(day),
      label: String(day).padStart(2, "0"),
    }));
    const currentDateParts = getCurrentStationDateParts();
    if (
      preferCurrentDate &&
      selectedYear === currentDateParts.year &&
      selectedMonth === currentDateParts.month
    ) {
      setSelectToCurrentDatePart(daySelect, currentDateParts.day);
    }
  }

  function populateHourOptions() {
    const selectedDay = Number(daySelect.value);
    const hourSlots = hierarchicalCatalogEnabled
      ? [...(currentDayCatalog?.hour_slots || [])]
      : [];
    const archives = hierarchicalCatalogEnabled
      ? [...(currentDayCatalog?.archives || [])]
      : filteredArchives();
    if (!selectedDay || (archives.length === 0 && hourSlots.length === 0)) {
      clearSelect(hourSelect, "Wybierz godzinę", true);
      syncSelectedArchive();
      return;
    }

    if (hourSlots.length > 0) {
      const sortedSlots = hourSlots
        .slice()
        .sort((left, right) => Date.parse(left.local_started_at) - Date.parse(right.local_started_at));
      fillSelect(hourSelect, sortedSlots, (slot) => buildHourSlotOption(slot));
      syncSelectedArchive();
      return;
    }

    const hourOptions = archives
      .slice()
      .sort((left, right) => Date.parse(left.local_started_at) - Date.parse(right.local_started_at));

    fillSelect(hourSelect, hourOptions, (archive) => ({
      value: String(archive.hourly_archive_id),
      label: `${archive.local_hour_label || formatHourLabel(archive.hour)} (${Math.round(
        archive.completeness_ratio * 100,
      )}%)`,
    }));
    syncSelectedArchive();
  }

  function buildHourSlotOption(slot) {
    const hourLabel = slot.local_hour_label || formatHourLabel(slot.hour);
    if (slot.playable && Number.isFinite(Number(slot.hourly_archive_id))) {
      return {
        value: String(slot.hourly_archive_id),
        label: `${hourLabel} (${Math.round((slot.completeness_ratio || 0) * 100)}%)`,
      };
    }
    const slotKey =
      slot.utc_started_at ||
      `${slot.year || "x"}-${slot.month || "x"}-${slot.day || "x"}-${slot.hour || "x"}`;
    return {
      value: `slot:${slotKey}`,
      label: `${hourLabel} — ${slot.status_label || "Niedostępne"}`,
      title: slot.status_label || "Niedostępne",
    };
  }

  function filteredArchives() {
    if (!stationCatalog) {
      return [];
    }
    if (hierarchicalCatalogEnabled) {
      return currentDayCatalog?.archives || [];
    }
    const selectedYear = Number(yearSelect.value);
    const selectedMonth = Number(monthSelect.value);
    const selectedDay = Number(daySelect.value);

    return stationCatalog.archives.filter((archive) => {
      if (selectedYear && archive.year !== selectedYear) {
        return false;
      }
      if (selectedMonth && archive.month !== selectedMonth) {
        return false;
      }
      if (selectedDay && archive.day !== selectedDay) {
        return false;
      }
      return true;
    });
  }

  function syncSelectedArchive() {
    const selectedValue = String(hourSelect.value || "");
    const archives = hierarchicalCatalogEnabled
      ? currentDayCatalog?.archives || []
      : stationCatalog?.archives || [];
    const hourSlots = hierarchicalCatalogEnabled ? currentDayCatalog?.hour_slots || [] : [];
    selectedHourSlot = null;
    const archiveId = Number(selectedValue);
    selectedArchive = Number.isFinite(archiveId)
      ? archives.find((archive) => archive.hourly_archive_id === archiveId) || null
      : null;
    if (!selectedArchive && selectedValue.startsWith("slot:")) {
      selectedHourSlot =
        hourSlots.find((slot) => buildHourSlotOption(slot).value === selectedValue) || null;
    }
    loadButton.disabled = !selectedArchive;
    if (selectedArchive) {
      setStatus(
        `Wybrano ${selectedArchive.local_hour_label || formatHourLabel(selectedArchive.hour)} z dnia ${selectedArchive.local_date_label || formatDateLabel(selectedArchive)} dla ${stationCatalog.station.display_name}.`,
      );
      return;
    }
    if (selectedHourSlot) {
      setStatus(
        `${selectedHourSlot.local_hour_label || formatHourLabel(selectedHourSlot.hour)} z dnia ${selectedHourSlot.local_date_label || formatDateLabel(selectedHourSlot)} dla ${stationCatalog.station.display_name}: ${selectedHourSlot.status_label || "Niedostępne"}.`,
      );
    }
  }

  async function loadArchiveIntoPlayer(archive) {
    disposeActivePlaybackState();
    selectedArchive = archive;
    const playbackState = {
      archiveId: archive.hourly_archive_id,
      originalUrl: archive.audio_url,
      currentUrl: archive.audio_url,
      fallbackUrl: null,
      fallbackAttempted: false,
      localObjectUrl: null,
      cachedLocally: false,
      backgroundFetchController: null,
      backgroundFetchKey: null,
    };
    activePlaybackState = playbackState;
    const preferredSource = await resolvePreferredPlaybackSource(archive);
    if (
      !selectedArchive ||
      selectedArchive.hourly_archive_id !== archive.hourly_archive_id ||
      activePlaybackState !== playbackState
    ) {
      return;
    }
    playbackState.currentUrl = preferredSource.url;
    playbackState.fallbackUrl = preferredSource.fallbackUrl || null;
    playbackState.fallbackAttempted = preferredSource.url !== archive.audio_url;
    await applyPlaybackSource(playbackState, preferredSource.url);
    audio.playbackRate = Number(rateSelect.value);
    setDownloadLinkState(archive.download_url, archive.remote_filename || null);
    configureFragmentDownloadControls(archive);
    titleNode.textContent = `${stationCatalog.station.display_name} · ${archive.local_date_label || formatDateLabel(archive)}`;
    subtitleNode.textContent =
      `${archive.local_hour_label || formatHourLabel(archive.hour)} (${Math.round(
        archive.completeness_ratio * 100,
      )}%)` + ` · ${formatDuration(archive.duration_seconds)}`;
    seekInput.value = "0";
    seekInput.max = "0";
    seekInput.disabled = true;
    currentTimeNode.textContent = "00:00";
    durationNode.textContent = formatDuration(archive.duration_seconds);
    playButton.textContent = "Odtwórz";
    setPlayerLoadedState(true);
    syncUrlState();
    void warmPlaybackSource(playbackState, archive, preferredSource.url);
    if (preferredSource.reason === "derivative") {
      setStatus(
        `Załadowano derivat do odtwarzania dla ${archive.local_hour_label || formatHourLabel(archive.hour)}; oryginał nadal jest dostępny do pobrania.`,
      );
      return;
    }
    if (preferredSource.reason === "original-no-derivative") {
      setStatus(
        `Załadowano oryginalny OGG dla ${archive.local_hour_label || formatHourLabel(archive.hour)}. Ta przeglądarka może go nie odtworzyć, jeśli archive.org nie ma jeszcze derivatu.`,
      );
      return;
    }
    setStatus(
      `Załadowano nagranie ${archive.local_hour_label || formatHourLabel(archive.hour)}. Plik dociąga się teraz w tle do lokalnej kopii.`,
    );
  }

  function resetArchiveSelection() {
    disposeActivePlaybackState();
    stationCatalog = null;
    clearDependentCatalogState();
    selectedArchive = null;
    selectedHourSlot = null;
    clearSelect(yearSelect, "Wybierz rok", true);
    clearSelect(monthSelect, "Wybierz miesiąc", true);
    clearSelect(daySelect, "Wybierz dzień", true);
    clearSelect(hourSelect, "Wybierz godzinę", true);
    loadButton.disabled = true;
    setDownloadLinkState(null, null);
    resetFragmentDownloadControls();
    activePlaybackState = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    seekInput.value = "0";
    seekInput.max = "0";
    seekInput.disabled = true;
    currentTimeNode.textContent = "00:00";
    durationNode.textContent = "00:00";
    seekInput.setAttribute("aria-valuetext", "00:00 z 00:00");
    seekInput.setAttribute("title", "00:00 z 00:00");
    titleNode.textContent = "Nie wybrano godziny";
    subtitleNode.textContent =
      "Po załadowaniu zobaczysz tutaj datę i godzinę według czasu polskiego.";
    playButton.textContent = "Odtwórz";
    setPlayerLoadedState(false);
  }

  async function handleYearChange(options = {}) {
    const { preferCurrentDate = false } = options;
    if (!hierarchicalCatalogEnabled) {
      populateMonthOptions({ preferCurrentDate });
      populateDayOptions({ preferCurrentDate });
      populateHourOptions();
      return;
    }
    const slug = stationSelect.value;
    const year = Number(yearSelect.value);
    currentYearIndex = null;
    currentMonthIndex = null;
    currentDayCatalog = null;
    clearSelect(monthSelect, "Wybierz miesiąc", true);
    clearSelect(daySelect, "Wybierz dzień", true);
    clearSelect(hourSelect, "Wybierz godzinę", true);
    syncSelectedArchive();
    if (!slug || !year) {
      return;
    }
    try {
      currentYearIndex = await fetchYearIndex(slug, year);
    } catch (error) {
      setStatus(`Nie udało się pobrać miesięcy: ${error}`);
      return;
    }
    populateMonthOptions({ preferCurrentDate });
    await handleMonthChange({ preferCurrentDate });
  }

  async function handleMonthChange(options = {}) {
    const { preferCurrentDate = false } = options;
    if (!hierarchicalCatalogEnabled) {
      populateDayOptions({ preferCurrentDate });
      populateHourOptions();
      return;
    }
    const slug = stationSelect.value;
    const year = Number(yearSelect.value);
    const month = Number(monthSelect.value);
    currentMonthIndex = null;
    currentDayCatalog = null;
    clearSelect(daySelect, "Wybierz dzień", true);
    clearSelect(hourSelect, "Wybierz godzinę", true);
    syncSelectedArchive();
    if (!slug || !year || !month) {
      return;
    }
    try {
      currentMonthIndex = await fetchMonthIndex(slug, year, month);
    } catch (error) {
      setStatus(`Nie udało się pobrać dni: ${error}`);
      return;
    }
    populateDayOptions({ preferCurrentDate });
    await handleDayChange();
  }

  async function handleDayChange() {
    if (!hierarchicalCatalogEnabled) {
      populateHourOptions();
      return;
    }
    const slug = stationSelect.value;
    const year = Number(yearSelect.value);
    const month = Number(monthSelect.value);
    const day = Number(daySelect.value);
    currentDayCatalog = null;
    clearSelect(hourSelect, "Wybierz godzinę", true);
    syncSelectedArchive();
    if (!slug || !year || !month || !day) {
      return;
    }
    try {
      currentDayCatalog = await fetchDayCatalog(slug, year, month, day);
    } catch (error) {
      setStatus(`Nie udało się pobrać godzin: ${error}`);
      return;
    }
    populateHourOptions();
  }

  function clearSelect(select, placeholder, disabled) {
    select.innerHTML = "";
    const option = document.createElement("option");
    option.value = "";
    option.textContent = placeholder;
    select.append(option);
    select.disabled = disabled;
  }

  function extractStationsFromSelectOptions() {
    return Array.from(stationSelect.options)
      .filter((option) => option.value)
      .map((option) => {
        const match = option.textContent.match(/^(.*?)(?: \\(([0-9]+) h\\))?$/);
        return normalizeStationOption({
          slug: option.value,
          display_name: match?.[1]?.trim() || option.textContent.trim(),
          public_name: match?.[1]?.trim() || option.textContent.trim(),
          archive_count: Number(match?.[2] || 0),
        });
      })
      .filter((station) => station !== null);
  }

  function normalizeStationOption(station) {
    if (!station || !station.slug || !station.display_name) {
      return null;
    }
    return {
      slug: String(station.slug),
      display_name: String(station.display_name),
      public_name: String(station.public_name || station.display_name),
      archive_count: Number(station.archive_count || 0),
    };
  }

  function applyStationFilter() {
    const selectedSlug = stationSelect.value;
    const query = stationFilterInput?.value.trim() || "";
    if (allStations.length === 0) {
      clearSelect(stationSelect, "Wybierz stację", true);
      return;
    }

    const stations = filterStations(allStations, query, selectedSlug);
    if (stations.length === 0) {
      clearSelect(stationSelect, "Brak pasujących stacji", true);
      return;
    }

    fillSelect(
      stationSelect,
      stations,
      (station) => ({
        value: station.slug,
        label: `${station.display_name} (${station.archive_count} h)`,
      }),
      { autoSelectFirst: false },
    );
  }

  function filterStations(stations, query, selectedSlug) {
    if (!query) {
      return stations;
    }
    const scored = stations
      .map((station) => ({
        station,
        score: scoreStationQueryMatch(station, query),
      }))
      .filter((entry) => entry.score >= 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.station.display_name.localeCompare(right.station.display_name, "pl");
      });

    const matchedStations = scored.map((entry) => entry.station);
    const selectedPinned =
      Boolean(selectedSlug) &&
      !matchedStations.some((station) => station.slug === selectedSlug);
    if (!selectedPinned) {
      return matchedStations;
    }
    const selectedStation = stations.find((station) => station.slug === selectedSlug);
    if (!selectedStation) {
      return matchedStations;
    }
    return [selectedStation, ...matchedStations];
  }

  function scoreStationQueryMatch(station, rawQuery) {
    const query = normalizeSearchText(rawQuery);
    if (!query) {
      return 0;
    }
    const compactQuery = compactSearchText(query);
    const fields = buildStationSearchFields(station);
    const terms = query.split(/\s+/).filter(Boolean);
    let score = 0;
    for (const term of terms) {
      const compactTerm = compactSearchText(term);
      let termScore = 0;
      for (const field of fields) {
        if (!field.normalized) {
          continue;
        }
        if (field.normalized === term || field.compact === compactTerm) {
          termScore = Math.max(termScore, 700);
        } else if (field.core.startsWith(term) || field.compactCore.startsWith(compactTerm)) {
          termScore = Math.max(termScore, 520);
        } else if (field.normalized.startsWith(term) || field.compact.startsWith(compactTerm)) {
          termScore = Math.max(termScore, 420);
        } else if (field.normalized.includes(term) || field.compact.includes(compactTerm)) {
          termScore = Math.max(termScore, 300);
        } else if (isSubsequenceMatch(field.compactCore, compactTerm)) {
          termScore = Math.max(termScore, 180);
        } else if (isSubsequenceMatch(field.compact, compactTerm)) {
          termScore = Math.max(termScore, 120);
        }
      }
      if (termScore === 0) {
        return -1;
      }
      score += termScore;
    }
    if (fields.some((field) => field.core.startsWith(query) || field.compactCore.startsWith(compactQuery))) {
      score += 120;
    }
    return score;
  }

  function buildStationSearchFields(station) {
    return [station.display_name, station.public_name, station.slug].map((value) => {
      const normalized = normalizeSearchText(value);
      const core = stripCommonStationPrefix(normalized);
      return {
        normalized,
        compact: compactSearchText(normalized),
        core,
        compactCore: compactSearchText(core),
      };
    });
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function compactSearchText(value) {
    return normalizeSearchText(value).replace(/\s+/g, "");
  }

  function stripCommonStationPrefix(value) {
    return value
      .replace(/^(polskie radio)\s+/u, "")
      .replace(/^(radio)\s+/u, "")
      .replace(/^(program)\s+/u, "")
      .trim();
  }

  function isSubsequenceMatch(haystack, needle) {
    if (!needle) {
      return true;
    }
    let position = 0;
    for (const character of haystack) {
      if (character === needle[position]) {
        position += 1;
        if (position === needle.length) {
          return true;
        }
      }
    }
    return false;
  }

  function fillSelect(select, values, toOption, options = {}) {
    const { autoSelectFirst = true } = options;
    const previousValue = select.value;
    clearSelect(select, select.options[0]?.textContent || "Wybierz", false);
    let firstEnabledValue = "";
    let previousValueStillEnabled = false;
    values.forEach((value) => {
      const optionData = toOption(value);
      const option = document.createElement("option");
      option.value = optionData.value;
      option.textContent = optionData.label;
      if (optionData.disabled) {
        option.disabled = true;
      }
      if (optionData.title) {
        option.title = optionData.title;
      }
      if (!option.disabled && !firstEnabledValue) {
        firstEnabledValue = option.value;
      }
      if (!option.disabled && option.value === previousValue) {
        previousValueStillEnabled = true;
      }
      select.append(option);
    });
    const nextValue =
      previousValueStillEnabled
        ? previousValue
        : autoSelectFirst
          ? firstEnabledValue
          : "";
    select.value = nextValue;
    select.disabled = values.length === 0;
  }

  function uniqueValues(values) {
    return Array.from(new Set(values));
  }

  function updateTimeReadout() {
    const currentTime = formatDuration(audio.currentTime || 0);
    const duration = formatDuration(audio.duration || 0);
    currentTimeNode.textContent = currentTime;
    durationNode.textContent = duration;
    if (!seekInput.disabled) {
      seekInput.value = String(Math.floor(audio.currentTime || 0));
    }
    const valueText = `${currentTime} z ${duration}`;
    seekInput.setAttribute("aria-valuetext", valueText);
    seekInput.setAttribute("title", valueText);
  }

  function formatDuration(totalSeconds) {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
      return "00:00";
    }
    const rounded = Math.floor(totalSeconds);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const seconds = rounded % 60;
    if (hours > 0) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
        seconds,
      ).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function setStatus(message) {
    statusNode.textContent = message;
  }

  async function handleAudioPlaybackError() {
    if (!selectedArchive || !activePlaybackState) {
      setStatus("Nie udało się załadować pliku audio dla wybranej godziny.");
      return;
    }
    const playbackState = activePlaybackState;
    if (
      playbackState.archiveId !== selectedArchive.hourly_archive_id ||
      playbackState.fallbackAttempted
    ) {
      setStatus("Nie udało się załadować pliku audio dla wybranej godziny.");
      return;
    }
    const derivativeUrl =
      playbackState.fallbackUrl || (await resolveArchiveOrgDerivativeUrl(selectedArchive));
    playbackState.fallbackAttempted = true;
    playbackState.fallbackUrl = derivativeUrl || null;
    if (!derivativeUrl || derivativeUrl === playbackState.currentUrl) {
      setStatus("Nie udało się załadować pliku audio dla wybranej godziny.");
      return;
    }
    const shouldResumePlayback = !audio.paused;
    playbackState.currentUrl = derivativeUrl;
    revokePlaybackObjectUrl(playbackState);
    await applyPlaybackSource(playbackState, derivativeUrl);
    setStatus(
      "Oryginalny plik OGG nie odtworzył się poprawnie. Przełączam na derivat audio z archive.org.",
    );
    if (shouldResumePlayback) {
      try {
        await audio.play();
      } catch (error) {
        setStatus(`Nie udało się rozpocząć odtwarzania derivatu: ${error}`);
      }
    }
  }

  function disposeActivePlaybackState() {
    if (!activePlaybackState) {
      return;
    }
    if (activePlaybackState.backgroundFetchController) {
      activePlaybackState.backgroundFetchController.abort();
      activePlaybackState.backgroundFetchController = null;
    }
    revokePlaybackObjectUrl(activePlaybackState);
  }

  function revokePlaybackObjectUrl(playbackState) {
    if (!playbackState?.localObjectUrl) {
      return;
    }
    URL.revokeObjectURL(playbackState.localObjectUrl);
    playbackState.localObjectUrl = null;
    playbackState.cachedLocally = false;
  }

  async function applyPlaybackSource(playbackState, sourceUrl, options = {}) {
    const { preservePosition = false } = options;
    const resumePlayback = preservePosition && !audio.paused;
    const previousTime =
      preservePosition && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const previousRate = audio.playbackRate || Number(rateSelect.value) || 1;
    audio.src = sourceUrl;
    audio.load();
    audio.playbackRate = previousRate;
    if (!preservePosition) {
      return;
    }
    try {
      await waitForAudioEvent(audio, "loadedmetadata");
      if (Number.isFinite(previousTime) && previousTime > 0) {
        const safeTarget = Number.isFinite(audio.duration)
          ? Math.min(previousTime, Math.max(0, audio.duration - 0.25))
          : previousTime;
        audio.currentTime = Math.max(0, safeTarget);
      }
      if (resumePlayback) {
        await audio.play();
      }
    } catch (_error) {
      // Keep the loaded source even if metadata restoration was interrupted.
    }
  }

  function waitForAudioEvent(mediaElement, eventName) {
    return new Promise((resolve, reject) => {
      let timeoutId = null;
      const cleanup = () => {
        mediaElement.removeEventListener(eventName, handleSuccess);
        mediaElement.removeEventListener("error", handleError);
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
      };
      const handleSuccess = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error(`audio ${eventName} failed`));
      };
      mediaElement.addEventListener(eventName, handleSuccess, { once: true });
      mediaElement.addEventListener("error", handleError, { once: true });
      timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error(`audio ${eventName} timed out`));
      }, 15_000);
    });
  }

  async function warmPlaybackSource(playbackState, archive, sourceUrl) {
    if (!canWarmPlaybackSource(sourceUrl)) {
      return;
    }
    const cacheKey = buildLocalAudioCacheKey(archive, sourceUrl);
    playbackState.backgroundFetchKey = cacheKey;

    const cachedBlobUrl = await restoreCachedPlaybackUrl(playbackState, cacheKey);
    if (!isActivePlaybackState(playbackState)) {
      return;
    }
    if (cachedBlobUrl) {
      await switchPlaybackToLocalCopy(playbackState, cachedBlobUrl, {
        announce: false,
      });
      return;
    }

    const controller = new AbortController();
    playbackState.backgroundFetchController = controller;
    try {
      const response = await fetch(sourceUrl, {
        cache: "force-cache",
        credentials: "omit",
        mode: "cors",
        signal: controller.signal,
      });
      if (!response.ok) {
        return;
      }
      const blob = await response.blob();
      if (!isActivePlaybackState(playbackState)) {
        return;
      }
      await persistLocalPlaybackCopy(cacheKey, response, blob);
      if (!isActivePlaybackState(playbackState)) {
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      await switchPlaybackToLocalCopy(playbackState, objectUrl, {
        announce: true,
      });
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.warn("Nie udało się dociągnąć pliku audio w tle.", error);
      }
    } finally {
      if (playbackState.backgroundFetchController === controller) {
        playbackState.backgroundFetchController = null;
      }
    }
  }

  function canWarmPlaybackSource(sourceUrl) {
    if (!sourceUrl || typeof fetch !== "function" || typeof URL !== "function") {
      return false;
    }
    try {
      const parsed = new URL(sourceUrl, window.location.href);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (_error) {
      return false;
    }
  }

  function buildLocalAudioCacheKey(archive, sourceUrl) {
    const cacheUrl = new URL(
      `/__player_audio_cache__/${encodeURIComponent(String(archive.hourly_archive_id))}`,
      window.location.href,
    );
    cacheUrl.searchParams.set("source", sourceUrl);
    return cacheUrl.toString();
  }

  async function restoreCachedPlaybackUrl(playbackState, cacheKey) {
    const cache = await openLocalAudioCache();
    if (!cache) {
      return null;
    }
    try {
      const cachedResponse = await cache.match(cacheKey);
      if (!cachedResponse) {
        return null;
      }
      const blob = await cachedResponse.blob();
      return URL.createObjectURL(blob);
    } catch (_error) {
      return null;
    }
  }

  async function persistLocalPlaybackCopy(cacheKey, response, blob) {
    const cache = await openLocalAudioCache();
    if (!cache) {
      return;
    }
    try {
      const headers = new Headers();
      const contentType = response.headers.get("content-type") || blob.type;
      if (contentType) {
        headers.set("content-type", contentType);
      }
      const cachedResponse = new Response(blob, {
        headers,
        status: 200,
        statusText: "OK",
      });
      await cache.put(cacheKey, cachedResponse);
      await pruneLocalAudioCache(cache, cacheKey);
    } catch (_error) {
      // Ignore Cache Storage quota/errors and continue with in-memory playback only.
    }
  }

  async function openLocalAudioCache() {
    if (!("caches" in window) || typeof window.caches?.open !== "function") {
      return null;
    }
    try {
      return await window.caches.open(localAudioCacheName);
    } catch (_error) {
      return null;
    }
  }

  async function pruneLocalAudioCache(cache, preferredKey) {
    try {
      const requests = await cache.keys();
      if (requests.length <= maxLocalAudioCacheEntries) {
        return;
      }
      const preferredUrl = new URL(preferredKey, window.location.href).toString();
      const removable = requests.filter((request) => request.url !== preferredUrl);
      let remaining = requests.length;
      while (remaining > maxLocalAudioCacheEntries && removable.length > 0) {
        const oldest = removable.shift();
        if (!oldest) {
          break;
        }
        await cache.delete(oldest);
        remaining -= 1;
      }
    } catch (_error) {
      // Best-effort pruning only.
    }
  }

  function isActivePlaybackState(playbackState) {
    return Boolean(
      playbackState &&
        activePlaybackState === playbackState &&
        selectedArchive &&
        selectedArchive.hourly_archive_id === playbackState.archiveId,
    );
  }

  async function switchPlaybackToLocalCopy(playbackState, objectUrl, options = {}) {
    const { announce = false } = options;
    if (!isActivePlaybackState(playbackState)) {
      URL.revokeObjectURL(objectUrl);
      return;
    }
    if (playbackState.currentUrl === objectUrl) {
      return;
    }
    revokePlaybackObjectUrl(playbackState);
    playbackState.localObjectUrl = objectUrl;
    playbackState.cachedLocally = true;
    playbackState.currentUrl = objectUrl;
    await applyPlaybackSource(playbackState, objectUrl, { preservePosition: true });
    if (!isActivePlaybackState(playbackState)) {
      revokePlaybackObjectUrl(playbackState);
      return;
    }
    if (announce) {
      const hourLabel =
        selectedArchive?.local_hour_label || formatHourLabel(selectedArchive?.hour || 0);
      setStatus(
        `Nagranie ${hourLabel} zostało dociągnięte do lokalnej kopii. Dalsze przewijanie powinno działać płynniej.`,
      );
    }
  }

  async function resolvePreferredPlaybackSource(archive) {
    if (!archive || !shouldPreferOriginalAudioSource(archive)) {
      return { url: archive.audio_url, fallbackUrl: null, reason: "default" };
    }
    if (browserSupportsArchiveFormat(archive.remote_filename || "")) {
      return { url: archive.audio_url, fallbackUrl: null, reason: "original" };
    }
    const derivativeUrl = await resolveArchiveOrgDerivativeUrl(archive);
    if (derivativeUrl) {
      return { url: derivativeUrl, fallbackUrl: derivativeUrl, reason: "derivative" };
    }
    return {
      url: archive.audio_url,
      fallbackUrl: null,
      reason: "original-no-derivative",
    };
  }

  function shouldPreferOriginalAudioSource(archive) {
    const filename = String(archive?.remote_filename || "").toLowerCase();
    return filename.endsWith(".ogg") || filename.endsWith(".oga") || filename.endsWith(".opus");
  }

  function browserSupportsArchiveFormat(filename) {
    const normalized = String(filename || "").toLowerCase();
    if (!normalized) {
      return false;
    }
    if (normalized.endsWith(".ogg") || normalized.endsWith(".oga")) {
      return canPlayAudioMime('audio/ogg; codecs="vorbis"') || canPlayAudioMime("audio/ogg");
    }
    if (normalized.endsWith(".opus")) {
      return canPlayAudioMime('audio/ogg; codecs="opus"') || canPlayAudioMime("audio/ogg");
    }
    return canPlayAudioMime(inferAudioMimeType(filename));
  }

  function canPlayAudioMime(mimeType) {
    if (!mimeType || typeof audio.canPlayType !== "function") {
      return false;
    }
    const result = audio.canPlayType(mimeType);
    return result === "probably" || result === "maybe";
  }

  function inferAudioMimeType(filename) {
    const normalized = String(filename || "").toLowerCase();
    if (normalized.endsWith(".ogg") || normalized.endsWith(".oga")) {
      return "audio/ogg";
    }
    if (normalized.endsWith(".opus")) {
      return "audio/ogg";
    }
    return "audio/mpeg";
  }

  async function resolveArchiveOrgDerivativeUrl(archive) {
    const identifier = archive?.archive_item_identifier;
    const originalFilename = archive?.remote_filename;
    if (!identifier || !originalFilename) {
      return null;
    }
    const cacheKey = `${identifier}:${originalFilename}`;
    if (derivativeUrlCache.has(cacheKey)) {
      return derivativeUrlCache.get(cacheKey);
    }
    try {
      const metadataUrl =
        `https://archive.org/metadata/${encodeURIComponent(identifier)}?t=${Date.now()}`;
      const response = await fetch(metadataUrl, {
        cache: "no-store",
        credentials: "omit",
        mode: "cors",
      });
      if (!response.ok) {
        derivativeUrlCache.set(cacheKey, null);
        return null;
      }
      const payload = await response.json();
      const files = Array.isArray(payload?.files) ? payload.files : [];
      const derivative = selectPreferredArchiveDerivative(files, originalFilename);
      const derivativeUrl = derivative
        ? buildArchiveOrgFileUrl(identifier, derivative.name)
        : null;
      derivativeUrlCache.set(cacheKey, derivativeUrl);
      return derivativeUrl;
    } catch (_error) {
      derivativeUrlCache.set(cacheKey, null);
      return null;
    }
  }

  function selectPreferredArchiveDerivative(files, originalFilename) {
    const matches = files.filter((file) => {
      if (!file || typeof file.name !== "string") {
        return false;
      }
      const candidateName = file.name.toLowerCase();
      if (!candidateName.endsWith(".mp3")) {
        return false;
      }
      return file.original === originalFilename;
    });
    if (matches.length === 0) {
      return null;
    }
    const sorted = matches.slice().sort((left, right) => {
      return scoreArchiveDerivative(right) - scoreArchiveDerivative(left);
    });
    return sorted[0] || null;
  }

  function scoreArchiveDerivative(file) {
    const format = String(file?.format || "").toLowerCase();
    if (format.includes("vbr mp3")) {
      return 300;
    }
    const bitrateMatch = format.match(/(\d+)\s*kbps mp3/);
    if (bitrateMatch) {
      return 200 + Number.parseInt(bitrateMatch[1], 10);
    }
    if (format.includes("mp3")) {
      return 100;
    }
    return 0;
  }

  function buildArchiveOrgFileUrl(identifier, filename) {
    return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(filename)}`;
  }

  function setDownloadLinkState(url, filename) {
    if (!url) {
      downloadLink.href = "#";
      delete downloadLink.dataset.filename;
      downloadLink.setAttribute("aria-disabled", "true");
      downloadLink.tabIndex = -1;
      return;
    }
    downloadLink.href = url;
    if (filename) {
      downloadLink.dataset.filename = filename;
    } else {
      delete downloadLink.dataset.filename;
    }
    downloadLink.setAttribute("aria-disabled", "false");
    downloadLink.tabIndex = 0;
  }

  function configureFragmentDownloadControls(archive) {
    if (!fragmentDownloadSupported) {
      return;
    }
    const totalMinutes = getArchiveDurationMinutes(archive);
    fragmentDownloadGroup.hidden = false;
    fragmentStartMinuteInput.min = "0";
    fragmentStartMinuteInput.max = String(Math.max(0, totalMinutes - 1));
    fragmentStartMinuteInput.value = "0";
    fragmentEndMinuteInput.min = "1";
    fragmentEndMinuteInput.max = String(totalMinutes);
    fragmentEndMinuteInput.value = String(totalMinutes);
    syncFragmentDownloadState();
  }

  function resetFragmentDownloadControls() {
    if (!fragmentDownloadSupported) {
      return;
    }
    fragmentStartMinuteInput.value = "0";
    fragmentEndMinuteInput.value = "60";
    fragmentStartMinuteInput.setAttribute("aria-invalid", "false");
    fragmentEndMinuteInput.setAttribute("aria-invalid", "false");
    fragmentDownloadButton.disabled = true;
    fragmentDownloadGroup.hidden = true;
  }

  function syncFragmentDownloadState() {
    if (!fragmentDownloadSupported) {
      return;
    }
    const range = readFragmentDownloadRange(selectedArchive);
    const archiveSupported =
      !selectedArchive || canUseServerSideFragmentDownload() || canDownloadFragmentInBrowser(selectedArchive);
    fragmentStartMinuteInput.setAttribute("aria-invalid", String(!range.ok));
    fragmentEndMinuteInput.setAttribute("aria-invalid", String(!range.ok));
    fragmentDownloadButton.disabled = !range.ok || !archiveSupported;
  }

  function getArchiveDurationMinutes(archive) {
    return Math.max(1, Math.ceil(Number(archive?.duration_seconds || 0) / 60));
  }

  function readFragmentDownloadRange(archive) {
    if (!archive || !fragmentDownloadSupported) {
      return { ok: false, error: "Brak wybranego nagrania." };
    }
    const totalMinutes = getArchiveDurationMinutes(archive);
    const startMinute = Number.parseInt(fragmentStartMinuteInput.value || "", 10);
    const endMinute = Number.parseInt(fragmentEndMinuteInput.value || "", 10);
    if (!Number.isInteger(startMinute) || startMinute < 0 || startMinute >= totalMinutes) {
      return {
        ok: false,
        error: `Pole „Pobierz od” musi mieścić się w zakresie 0-${Math.max(0, totalMinutes - 1)}.`,
      };
    }
    if (!Number.isInteger(endMinute) || endMinute <= startMinute || endMinute > totalMinutes) {
      return {
        ok: false,
        error: `Pole „Pobierz do” musi być większe od pola „Pobierz od” i nie przekraczać ${totalMinutes}.`,
      };
    }
    return {
      ok: true,
      startMinute,
      endMinute,
      totalMinutes,
    };
  }

  function buildArchiveFragmentDownloadUrl(hourlyArchiveId, startMinute, endMinute) {
    const baseUrl = fragmentDownloadUrlTemplate.replace(
      "__archive_id__",
      encodeURIComponent(String(hourlyArchiveId)),
    );
    const resolvedUrl = new URL(baseUrl, window.location.href);
    resolvedUrl.searchParams.set("start_minute", String(startMinute));
    resolvedUrl.searchParams.set("end_minute", String(endMinute));
    return resolvedUrl.toString();
  }

  function setPlayerLoadedState(isLoaded) {
    emptyStateNode.hidden = isLoaded;
    loadedStateNode.hidden = !isLoaded;
  }

  function updateStationCount(count) {
    if (!stationCountNode) {
      return;
    }
    stationCountNode.textContent = String(Math.max(0, count));
  }

  function updateSnapshotMeta(
    publishedAt,
    latestArchiveHourStartedAt,
    latestArchiveHourStations = [],
    stationCount = 0,
  ) {
    if (!snapshotMetaNode) {
      return;
    }
    const formatter = new Intl.DateTimeFormat("pl-PL", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: displayTimeZone,
    });
    const parts = [];
    if (publishedAt) {
      const publishedDate = new Date(publishedAt);
      if (!Number.isNaN(publishedDate.getTime())) {
        parts.push(`Katalog opublikowano: ${formatter.format(publishedDate)} czasu polskiego.`);
      }
    }
    if (latestArchiveHourStartedAt) {
      const latestArchiveDate = new Date(latestArchiveHourStartedAt);
      if (!Number.isNaN(latestArchiveDate.getTime())) {
        parts.push(
          `Najnowsza godzina w katalogu: ${formatter.format(latestArchiveDate)} czasu polskiego.`,
        );
      }
    }
    if (Array.isArray(latestArchiveHourStations) && latestArchiveHourStations.length > 0) {
      if (stationCount > 0 && latestArchiveHourStations.length >= stationCount) {
        parts.push("Tę godzinę mają już wszystkie stacje.");
      } else {
        parts.push(
          `Mają ją już ${latestArchiveHourStations.length} z ${stationCount || "?"} stacji: ${latestArchiveHourStations.join(", ")}.`,
        );
      }
    }
    if (parts.length === 0) {
      snapshotMetaNode.textContent = "Brak informacji o ostatniej publikacji archiwum.";
      return;
    }
    snapshotMetaNode.textContent = parts.join(" ");
  }

  function buildCatalogUrl(slug) {
    return catalogUrlTemplate.replace("{slug}", encodeURIComponent(slug));
  }

  function buildTemplateUrl(template, replacements) {
    return Object.entries(replacements).reduce(
      (url, [key, value]) => url.replaceAll(`{${key}}`, encodeURIComponent(String(value))),
      template,
    );
  }

  async function fetchJson(url) {
    const response = await fetch(withCatalogVersion(url), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  function withCatalogVersion(url) {
    if (!catalogVersionToken) {
      return url;
    }
    try {
      const resolvedUrl = new URL(url, window.location.href);
      resolvedUrl.searchParams.set("v", catalogVersionToken);
      return resolvedUrl.toString();
    } catch (_error) {
      const separator = url.includes("?") ? "&" : "?";
      return `${url}${separator}v=${encodeURIComponent(catalogVersionToken)}`;
    }
  }

  function withRuntimeNoCache(url) {
    try {
      const resolvedUrl = new URL(url, window.location.href);
      resolvedUrl.searchParams.set("_", String(Date.now()));
      return resolvedUrl.toString();
    } catch (_error) {
      const separator = url.includes("?") ? "&" : "?";
      return `${url}${separator}_=${Date.now()}`;
    }
  }

  function setCatalogVersionToken(nextToken) {
    const normalizedToken = typeof nextToken === "string" ? nextToken : "";
    if (normalizedToken === catalogVersionToken) {
      return;
    }
    catalogVersionToken = normalizedToken;
    yearIndexCache.clear();
    monthIndexCache.clear();
    dayCatalogCache.clear();
  }

  async function fetchYearIndex(slug, year) {
    const cacheKey = `${slug}:${year}`;
    if (yearIndexCache.has(cacheKey)) {
      return yearIndexCache.get(cacheKey);
    }
    const payload = await fetchJson(
      buildTemplateUrl(yearIndexUrlTemplate, {
        slug,
        year,
      }),
    );
    yearIndexCache.set(cacheKey, payload);
    return payload;
  }

  async function fetchMonthIndex(slug, year, month) {
    const cacheKey = `${slug}:${year}:${month}`;
    if (monthIndexCache.has(cacheKey)) {
      return monthIndexCache.get(cacheKey);
    }
    const payload = await fetchJson(
      buildTemplateUrl(monthIndexUrlTemplate, {
        slug,
        year,
        month,
      }),
    );
    monthIndexCache.set(cacheKey, payload);
    return payload;
  }

  async function fetchDayCatalog(slug, year, month, day) {
    const cacheKey = `${slug}:${year}:${month}:${day}`;
    if (dayCatalogCache.has(cacheKey)) {
      return dayCatalogCache.get(cacheKey);
    }
    const payload = await fetchJson(
      buildTemplateUrl(dayCatalogUrlTemplate, {
        slug,
        year,
        month,
        day,
      }),
    );
    dayCatalogCache.set(cacheKey, payload);
    return payload;
  }

  function clearDependentCatalogState() {
    currentYearIndex = null;
    currentMonthIndex = null;
    currentDayCatalog = null;
    yearIndexCache.clear();
    monthIndexCache.clear();
    dayCatalogCache.clear();
  }

  function formatMonthLabel(month) {
    const label = monthFormatter.format(new Date(Date.UTC(2000, month - 1, 1)));
    return `${String(month).padStart(2, "0")} · ${label}`;
  }

  function formatHourLabel(hour) {
    return `${String(hour).padStart(2, "0")}:00`;
  }

  function formatDateLabel(archive) {
    return `${String(archive.day).padStart(2, "0")}.${String(archive.month).padStart(2, "0")}.${archive.year}`;
  }

  function getCurrentStationDateParts() {
    const timezone = stationCatalog?.station?.timezone || "UTC";
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });
    const parts = formatter.formatToParts(new Date());
    return {
      year: Number(parts.find((part) => part.type === "year")?.value || 0),
      month: Number(parts.find((part) => part.type === "month")?.value || 0),
      day: Number(parts.find((part) => part.type === "day")?.value || 0),
    };
  }

  function setSelectToCurrentDatePart(select, value) {
    const nextValue = String(value);
    const exists = Array.from(select.options).some((option) => option.value === nextValue);
    if (exists) {
      select.value = nextValue;
    }
  }

  async function togglePlayback() {
    if (audio.paused) {
      try {
        await audio.play();
      } catch (error) {
        setStatus(`Nie udało się rozpocząć odtwarzania: ${error}`);
      }
      return;
    }
    audio.pause();
  }

  function seekBySeconds(deltaSeconds) {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
      return;
    }
    audio.currentTime = Math.max(0, Math.min(audio.currentTime + deltaSeconds, audio.duration));
  }

  function seekToPercent(percent) {
    const normalizedPercent = Math.max(0, Math.min(percent, 100));
    const targetTime =
      normalizedPercent === 0 ? 0 : audio.duration * (normalizedPercent / 100);
    audio.currentTime = targetTime;
    setStatus(`Przeskoczono do ${normalizedPercent}% nagrania.`);
  }

  function toggleMute() {
    audio.muted = !audio.muted;
    setStatus(audio.muted ? "Dźwięk wyciszony." : "Dźwięk przywrócony.");
  }

  async function triggerArchiveDownload(archive) {
    const filename =
      archive.remote_filename ||
      downloadLink.dataset.filename ||
      extractFilenameFromUrl(archive.download_url) ||
      "archiwum.mp3";
    const originalLabel = downloadLink.textContent;
    downloadLink.setAttribute("aria-disabled", "true");
    downloadLink.tabIndex = -1;
    downloadLink.textContent = "Pobieranie...";
    setStatus(`Pobieram plik ${filename} z archive.org...`);

    try {
      const response = await fetch(archive.download_url, { mode: "cors", credentials: "omit" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      triggerBlobDownload(blob, filename);
      setStatus(`Pobieranie pliku ${filename} zostało rozpoczęte.`);
    } catch (error) {
      setStatus(`Nie udało się pobrać pliku: ${error}`);
    } finally {
      downloadLink.textContent = originalLabel;
      setDownloadLinkState(archive.download_url, filename);
    }
  }

  async function triggerArchiveFragmentDownload(archive) {
    const range = readFragmentDownloadRange(archive);
    if (!range.ok) {
      setStatus(range.error);
      syncFragmentDownloadState();
      return;
    }
    const originalLabel = fragmentDownloadButton.textContent;
    fragmentDownloadButton.disabled = true;
    fragmentDownloadButton.textContent = "Przygotowanie...";
    setStatus(
      `Przygotowuję fragment od ${range.startMinute} do ${range.endMinute} minuty.`,
    );

    try {
      if (canUseServerSideFragmentDownload()) {
        const downloadUrl = buildArchiveFragmentDownloadUrl(
          archive.hourly_archive_id,
          range.startMinute,
          range.endMinute,
        );
        if (!isSameOriginUrl(downloadUrl)) {
          triggerDirectDownload(downloadUrl);
          setStatus(
            `Pobieranie fragmentu od ${range.startMinute} do ${range.endMinute} minuty zostało rozpoczęte.`,
          );
          return;
        }
        const response = await fetch(downloadUrl, {
          credentials: "same-origin",
        });
        if (!response.ok) {
          throw new Error(await readDownloadError(response));
        }
        const blob = await response.blob();
        const filename =
          extractFilenameFromDisposition(response.headers.get("content-disposition")) ||
          buildFragmentFilename(archive, range.startMinute, range.endMinute);
        triggerBlobDownload(blob, filename);
        setStatus(
          `Pobieranie fragmentu od ${range.startMinute} do ${range.endMinute} minuty zostało rozpoczęte.`,
        );
        return;
      }
      if (!canDownloadFragmentInBrowser(archive)) {
        throw new Error(
          "na publicznej stronie pobieranie fragmentu działa obecnie dla plików MP3",
        );
      }
      const blob = await buildBrowserArchiveFragmentBlob(archive, range);
      const filename = buildFragmentFilename(archive, range.startMinute, range.endMinute);
      triggerBlobDownload(blob, filename);
      setStatus(
        `Pobieranie fragmentu od ${range.startMinute} do ${range.endMinute} minuty zostało rozpoczęte.`,
      );
    } catch (error) {
      setStatus(`Nie udało się przygotować fragmentu: ${error}`);
    } finally {
      fragmentDownloadButton.textContent = originalLabel;
      syncFragmentDownloadState();
    }
  }

  function extractFilenameFromUrl(url) {
    try {
      const parsed = new URL(url, window.location.href);
      const parts = parsed.pathname.split("/");
      return parts[parts.length - 1] || null;
    } catch (_error) {
      return null;
    }
  }

  function buildFragmentFilename(archive, startMinute, endMinute) {
    const baseName =
      archive.remote_filename ||
      extractFilenameFromUrl(archive.download_url) ||
      "archiwum.mp3";
    const suffix = `_od-${String(startMinute).padStart(2, "0")}m_do-${String(endMinute).padStart(2, "0")}m.mp3`;
    return baseName.replace(/\.[^./]+$/u, "") + suffix;
  }

  function canUseServerSideFragmentDownload() {
    return serverFragmentDownloadSupported;
  }

  function canDownloadFragmentInBrowser(archive) {
    if (!archive || typeof fetch !== "function" || typeof Blob !== "function") {
      return false;
    }
    const filename = String(archive.remote_filename || "").toLowerCase();
    return filename.endsWith(".mp3");
  }

  async function buildBrowserArchiveFragmentBlob(archive, range) {
    const sourceUrl = archive.download_url || archive.audio_url;
    if (!sourceUrl) {
      throw new Error("brak źródłowego pliku audio");
    }

    const cacheKey = buildLocalAudioCacheKey(archive, sourceUrl);
    const cachedBlob = await restoreCachedPlaybackBlob(cacheKey);
    const totalBytes =
      cachedBlob?.size ||
      (await fetchAudioContentLength(sourceUrl));

    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      throw new Error("nie udało się ustalić rozmiaru pliku audio");
    }

    const byteRange = estimateMp3ByteRange(archive, range, totalBytes);
    if (cachedBlob) {
      return sliceMp3BlobFragment(cachedBlob, byteRange);
    }
    return fetchMp3BlobRange(sourceUrl, byteRange, totalBytes);
  }

  async function restoreCachedPlaybackBlob(cacheKey) {
    const cache = await openLocalAudioCache();
    if (!cache) {
      return null;
    }
    try {
      const cachedResponse = await cache.match(cacheKey);
      if (!cachedResponse) {
        return null;
      }
      return await cachedResponse.blob();
    } catch (_error) {
      return null;
    }
  }

  async function fetchAudioContentLength(sourceUrl) {
    try {
      const response = await fetch(sourceUrl, {
        method: "HEAD",
        cache: "no-store",
        credentials: "omit",
        mode: "cors",
      });
      if (!response.ok) {
        return await fetchAudioContentLengthFromRangeProbe(sourceUrl);
      }
      const contentLength = Number.parseInt(response.headers.get("content-length") || "", 10);
      if (Number.isFinite(contentLength) && contentLength > 0) {
        return contentLength;
      }
      return await fetchAudioContentLengthFromRangeProbe(sourceUrl);
    } catch (_error) {
      return await fetchAudioContentLengthFromRangeProbe(sourceUrl);
    }
  }

  async function fetchAudioContentLengthFromRangeProbe(sourceUrl) {
    try {
      const response = await fetch(sourceUrl, {
        cache: "no-store",
        credentials: "omit",
        mode: "cors",
        headers: {
          Range: "bytes=0-1",
        },
      });
      if (!response.ok) {
        return null;
      }
      const contentRange = response.headers.get("content-range") || "";
      const match = contentRange.match(/bytes\s+\d+-\d+\/(\d+)/iu);
      if (match) {
        const totalBytes = Number.parseInt(match[1], 10);
        if (Number.isFinite(totalBytes) && totalBytes > 0) {
          return totalBytes;
        }
      }
      const contentLength = Number.parseInt(response.headers.get("content-length") || "", 10);
      return Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;
    } catch (_error) {
      return null;
    }
  }

  function estimateMp3ByteRange(archive, range, totalBytes) {
    const totalSeconds = Math.max(1, Number(archive.duration_seconds || range.totalMinutes * 60));
    const bytesPerSecond = totalBytes / totalSeconds;
    const guardBytes = Math.max(4_096, Math.floor(bytesPerSecond * 1.5));
    const startSeconds = range.startMinute * 60;
    const endSeconds = Math.min(totalSeconds, range.endMinute * 60);
    const startByte = Math.max(0, Math.floor(startSeconds * bytesPerSecond) - guardBytes);
    const endByte = Math.min(
      totalBytes - 1,
      Math.max(startByte + 1, Math.ceil(endSeconds * bytesPerSecond) + guardBytes - 1),
    );
    return { startByte, endByte };
  }

  function sliceMp3BlobFragment(blob, byteRange) {
    const fragment = blob.slice(byteRange.startByte, byteRange.endByte + 1, "audio/mpeg");
    if (fragment.size <= 0) {
      throw new Error("nie udało się przygotować fragmentu z lokalnej kopii");
    }
    return fragment;
  }

  async function fetchMp3BlobRange(sourceUrl, byteRange, totalBytes) {
    const response = await fetch(sourceUrl, {
      cache: "no-store",
      credentials: "omit",
      mode: "cors",
      headers: {
        Range: `bytes=${byteRange.startByte}-${byteRange.endByte}`,
      },
    });
    if (!response.ok) {
      throw new Error(await readDownloadError(response));
    }
    const blob = await response.blob();
    if (blob.size <= 0) {
      throw new Error("źródło zwróciło pusty fragment audio");
    }
    if (response.status === 200 && blob.size >= totalBytes) {
      return sliceMp3BlobFragment(blob, byteRange);
    }
    return new Blob([blob], { type: "audio/mpeg" });
  }

  function extractFilenameFromDisposition(contentDisposition) {
    if (!contentDisposition) {
      return null;
    }
    const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/iu);
    if (utf8Match) {
      try {
        return decodeURIComponent(utf8Match[1]);
      } catch (_error) {
        return utf8Match[1];
      }
    }
    const basicMatch = contentDisposition.match(/filename="?([^";]+)"?/iu);
    return basicMatch ? basicMatch[1] : null;
  }

  async function readDownloadError(response) {
    try {
      const payload = await response.json();
      if (payload && typeof payload.detail === "string") {
        return payload.detail;
      }
    } catch (_error) {
      // Ignore non-JSON error bodies.
    }
    return `HTTP ${response.status}`;
  }

  function triggerBlobDownload(blob, filename) {
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }

  function triggerDirectDownload(url) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  function isSameOriginUrl(url) {
    try {
      const resolvedUrl = new URL(url, window.location.href);
      return resolvedUrl.origin === window.location.origin;
    } catch (_error) {
      return false;
    }
  }

  function extractDigitShortcut(event) {
    if (/^[0-9]$/.test(event.key)) {
      return Number(event.key);
    }
    if (/^Digit[0-9]$/.test(event.code) || /^Numpad[0-9]$/.test(event.code)) {
      return Number(event.code.slice(-1));
    }
    return null;
  }

  function isShortcutSuppressedTarget(target) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    if (target === rateSelect || target.closest("#player-rate")) {
      return false;
    }
    return Boolean(target.closest("input, select, textarea, [contenteditable='true']"));
  }

  void bootstrapPlayer();

  async function bootstrapPlayer() {
    await initializeAudioOutputSelection();
    const stationIndexLoaded = await loadStationIndex();
    if (!stationIndexLoaded) {
      return;
    }
    await applyInitialSelection();
    syncUrlState();
  }

  function parseInitialSelection() {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      return {
        station: searchParams.get("station") || "",
        year: parseNumericSearchParam(searchParams.get("year")),
        month: parseNumericSearchParam(searchParams.get("month")),
        day: parseNumericSearchParam(searchParams.get("day")),
        hour: parseNumericSearchParam(searchParams.get("hour")),
      };
    } catch (_error) {
      return {
        station: "",
        year: null,
        month: null,
        day: null,
        hour: null,
      };
    }
  }

  function parseNumericSearchParam(value) {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : null;
  }

  function optionExists(select, value) {
    const normalized = String(value);
    return Array.from(select.options).some((option) => option.value === normalized);
  }

  async function applyInitialSelection() {
    if (!initialSelection.station || !optionExists(stationSelect, initialSelection.station)) {
      return;
    }
    stationSelect.value = initialSelection.station;
    await loadStationCatalog(initialSelection.station, { preferCurrentDate: false });

    if (initialSelection.year && optionExists(yearSelect, initialSelection.year)) {
      yearSelect.value = String(initialSelection.year);
      await handleYearChange({ preferCurrentDate: false });
    }
    if (initialSelection.month && optionExists(monthSelect, initialSelection.month)) {
      monthSelect.value = String(initialSelection.month);
      await handleMonthChange({ preferCurrentDate: false });
    }
    if (initialSelection.day && optionExists(daySelect, initialSelection.day)) {
      daySelect.value = String(initialSelection.day);
      await handleDayChange();
    }
    if (!initialSelection.hour) {
      syncSelectedArchive();
      return;
    }
    const hourValue = resolveInitialHourValue(initialSelection.hour);
    if (hourValue && optionExists(hourSelect, hourValue)) {
      hourSelect.value = hourValue;
      syncSelectedArchive();
    }
  }

  function resolveInitialHourValue(hour) {
    if (!hierarchicalCatalogEnabled) {
      const matchingArchive = (stationCatalog?.archives || []).find(
        (archive) => Number(archive.hour) === Number(hour),
      );
      return matchingArchive ? String(matchingArchive.hourly_archive_id) : "";
    }
    const matchingArchive = (currentDayCatalog?.archives || []).find(
      (archive) => Number(archive.hour) === Number(hour),
    );
    if (matchingArchive) {
      return String(matchingArchive.hourly_archive_id);
    }
    const matchingSlot = (currentDayCatalog?.hour_slots || []).find(
      (slot) => Number(slot.hour) === Number(hour),
    );
    return matchingSlot ? buildHourSlotOption(matchingSlot).value : "";
  }

  function syncUrlState() {
    if (
      typeof window === "undefined" ||
      !window.history ||
      typeof window.history.replaceState !== "function"
    ) {
      return;
    }
    const nextUrl = new URL(window.location.href);
    const nextParams = new URLSearchParams();
    if (stationSelect.value) {
      nextParams.set("station", stationSelect.value);
    }
    if (yearSelect.value) {
      nextParams.set("year", yearSelect.value);
    }
    if (monthSelect.value) {
      nextParams.set("month", monthSelect.value);
    }
    if (daySelect.value) {
      nextParams.set("day", daySelect.value);
    }
    const currentHourValue =
      selectedArchive?.hour ??
      selectedHourSlot?.hour ??
      parseSelectedHourValue(hourSelect.value);
    if (Number.isFinite(Number(currentHourValue))) {
      nextParams.set("hour", String(currentHourValue));
    }
    const serializedParams = nextParams.toString();
    const currentSerializedParams = nextUrl.searchParams.toString();
    if (serializedParams === currentSerializedParams) {
      return;
    }
    nextUrl.search = serializedParams;
    window.history.replaceState(null, "", nextUrl.toString());
  }

  function parseSelectedHourValue(value) {
    if (!value) {
      return null;
    }
    if (value.startsWith("slot:")) {
      const selectedSlot = (currentDayCatalog?.hour_slots || []).find(
        (slot) => buildHourSlotOption(slot).value === value,
      );
      return selectedSlot?.hour ?? null;
    }
    const archiveId = Number(value);
    if (!Number.isFinite(archiveId)) {
      return null;
    }
    const archive = (currentDayCatalog?.archives || stationCatalog?.archives || []).find(
      (entry) => entry.hourly_archive_id === archiveId,
    );
    return archive?.hour ?? null;
  }

  async function initializeAudioOutputSelection() {
    if (!outputDeviceGroup || !outputDeviceSelect || !sinkSelectionSupported) {
      outputDeviceGroup?.setAttribute("hidden", "");
      return;
    }
    if (outputDeviceChooser) {
      outputDeviceChooser.hidden = !outputDeviceRefreshSupported;
    }
    await refreshAudioOutputDevices({ announce: false });
    const storedSinkId = getStoredSinkId();
    if (storedSinkId !== "default") {
      await applyAudioOutputDevice(storedSinkId, { announce: false });
    }
    setOutputDeviceStatus(
      sinkSelectionSupported
        ? "Wspierane przeglądarki pozwalają wybrać wyjście audio bez zatrzymywania odtwarzania."
        : "Ta przeglądarka nie udostępnia stronie zmiany urządzenia odtwarzającego.",
    );
  }

  async function refreshAudioOutputDevices(options = {}) {
    const { announce = false } = options;
    if (!outputDeviceGroup || !outputDeviceSelect || !sinkSelectionSupported) {
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = devices.filter((device) => device.kind === "audiooutput");
      const optionsList = buildAudioOutputOptions(audioOutputs);
      const currentSinkId = getCurrentSinkId();
      const storedSinkId = getStoredSinkId();
      const preferredSinkId = [currentSinkId, storedSinkId, "default"].find((candidate) =>
        optionsList.some((option) => option.value === candidate),
      ) || "default";

      fillSelect(
        outputDeviceSelect,
        optionsList,
        (option) => option,
        { autoSelectFirst: false },
      );
      outputDeviceSelect.value = preferredSinkId;
      outputDeviceGroup.hidden = optionsList.length <= 1 && !outputDeviceRefreshSupported;
      updateAudioOutputChooserLabel(optionsList.length);
      updateCurrentAudioOutputLabel();
      if (outputDeviceReset) {
        outputDeviceReset.hidden = outputDeviceSelect.value === "default";
      }

      if (announce && !outputDeviceGroup.hidden) {
        setOutputDeviceStatus("Lista urządzeń odtwarzających została odświeżona.");
        setStatus(`Odświeżono listę urządzeń odtwarzających.`);
      }
    } catch (_error) {
      outputDeviceGroup.hidden = true;
    }
  }

  function buildAudioOutputOptions(audioOutputs) {
    const options = [{ value: "default", label: "Domyślne urządzenie systemowe" }];
    let unnamedCounter = 1;

    audioOutputs.forEach((device) => {
      const value = normalizeSinkId(device.deviceId);
      if (options.some((option) => option.value === value)) {
        return;
      }
      const label = device.label?.trim() || `Urządzenie audio ${unnamedCounter++}`;
      options.push({ value, label });
    });

    return options;
  }

  function updateAudioOutputChooserLabel(optionCount) {
    if (!outputDeviceChooser) {
      return;
    }
    outputDeviceChooser.textContent =
      sinkPromptSupported
        ? optionCount <= 1
          ? "Otwórz wybór urządzenia"
          : "Zmień w przeglądarce"
        : "Odśwież listę urządzeń";
  }

  async function applyAudioOutputDevice(nextSinkId, options = {}) {
    const { announce = true } = options;
    if (!sinkSelectionSupported || !outputDeviceSelect) {
      return false;
    }

    const normalizedSinkId = normalizeSinkId(nextSinkId);
    const previousSinkId = getCurrentSinkId();
    if (normalizedSinkId === previousSinkId) {
      storeSinkId(normalizedSinkId);
      return true;
    }

    const wasPlaying = !audio.paused && !audio.ended;

    try {
      await audio.setSinkId(normalizedSinkId);
      storeSinkId(normalizedSinkId);
      outputDeviceSelect.value = normalizedSinkId;
      updateCurrentAudioOutputLabel();
      if (outputDeviceReset) {
        outputDeviceReset.hidden = normalizedSinkId === "default";
      }
      if (wasPlaying && audio.paused) {
        await audio.play();
      }
      if (announce) {
        const selectedOption = outputDeviceSelect.selectedOptions[0];
        setOutputDeviceStatus(
          `Wybrane wyjście audio: ${selectedOption?.textContent || "wybrane urządzenie"}.`,
        );
        setStatus(
          `Dźwięk przełączono na ${selectedOption?.textContent || "wybrane urządzenie"}.`,
        );
      }
      return true;
    } catch (error) {
      outputDeviceSelect.value = previousSinkId;
      updateCurrentAudioOutputLabel();
      if (outputDeviceReset) {
        outputDeviceReset.hidden = previousSinkId === "default";
      }
      if (announce) {
        setOutputDeviceStatus(
          `Nie udało się przełączyć wyjścia audio: ${formatErrorMessage(error)}.`,
        );
        setStatus(`Nie udało się przełączyć urządzenia odtwarzającego: ${error}`);
      }
      return false;
    }
  }

  async function promptForAudioOutputDevice() {
    if (!outputDeviceRefreshSupported) {
      setOutputDeviceStatus(
        "Ta przeglądarka nie udostępnia stronie zmiany urządzenia odtwarzającego.",
      );
      setStatus("Ta przeglądarka nie udostępnia stronie zmiany urządzenia odtwarzającego.");
      return;
    }
    outputDeviceChooser?.setAttribute("aria-busy", "true");
    setOutputDeviceStatus(
      sinkPromptSupported
        ? "Próbuję otworzyć wybór urządzenia odtwarzającego..."
        : "Próbuję odświeżyć pełną listę urządzeń odtwarzających...",
    );
    setStatus(
      sinkPromptSupported
        ? "Proszę przeglądarkę o pokazanie listy urządzeń odtwarzających..."
        : "Odświeżam listę urządzeń odtwarzających dla tej strony...",
    );
    try {
      if (sinkPromptSupported) {
        // Keep transient user activation intact for browsers that require it.
        const device = await navigator.mediaDevices.selectAudioOutput();
        const selectedSinkId = normalizeSinkId(device?.deviceId);
        await requestAudioDeviceAccessIfNeeded({ force: false });
        await refreshAudioOutputDevices();
        const switched = await applyAudioOutputDevice(selectedSinkId);
        if (!switched) {
          setOutputDeviceStatus(
            "Przeglądarka pokazała wybór urządzeń, ale nie udało się przełączyć wyjścia audio.",
          );
        }
        return;
      }

      await requestAudioDeviceAccessIfNeeded({ force: true });
      await refreshAudioOutputDevices({ announce: true });
      if (outputDeviceSelect.options.length > 1) {
        setOutputDeviceStatus(
          "Lista urządzeń została odświeżona. Możesz teraz wybrać konkretne wyjście z rozwijanej listy.",
        );
      } else {
        setOutputDeviceStatus(
          "Przeglądarka nadal udostępnia tylko urządzenie domyślne. To zwykle ograniczenie uprawnień albo platformy.",
        );
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        setOutputDeviceStatus("Wybór urządzenia został anulowany.");
        setStatus("Wybór urządzenia został anulowany w przeglądarce.");
        return;
      }
      if (error?.name === "NotAllowedError") {
        void explainAudioOutputPermissionState();
        setStatus(
          "Przeglądarka nie pokazała wyboru urządzeń albo zablokowała to uprawnienie. W Chrome sprawdź ustawienia witryny i spróbuj ponownie.",
        );
        return;
      }
      setOutputDeviceStatus(
        `Nie udało się pobrać listy urządzeń odtwarzających: ${formatErrorMessage(error)}.`,
      );
      setStatus(`Nie udało się pobrać listy urządzeń odtwarzających: ${error}`);
    } finally {
      outputDeviceChooser?.removeAttribute("aria-busy");
    }
  }

  async function requestAudioDeviceAccessIfNeeded(options = {}) {
    const { force = false } = options;
    if (!mediaPermissionSupported || !outputDeviceSelect) {
      return;
    }
    if (!force && outputDeviceSelect.options.length > 1) {
      return;
    }
    let stream = null;
    try {
      setOutputDeviceStatus(
        "Przeglądarka może poprosić jeszcze o zgodę na audio, aby ujawnić pełną listę urządzeń.",
      );
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      await refreshAudioOutputDevices({ announce: true });
    } catch (error) {
      setOutputDeviceStatus(
        `Nie udało się odblokować pełnej listy urządzeń przez uprawnienie audio: ${formatErrorMessage(error)}.`,
      );
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }

  async function explainAudioOutputPermissionState() {
    const speakerPermission = await querySpeakerSelectionPermission();
    const microphonePermission = await queryMediaPermission("microphone");
    if (speakerPermission === "denied") {
      setOutputDeviceStatus(
        "Przeglądarka zablokowała uprawnienie wyboru urządzenia odtwarzającego dla tej strony.",
      );
      return;
    }
    if (microphonePermission === "denied") {
      setOutputDeviceStatus(
        "Przeglądarka zablokowała uprawnienie audio dla tej strony, więc pełna lista urządzeń może być ukryta.",
      );
      return;
    }
    setOutputDeviceStatus(
      "Przeglądarka nie otworzyła listy urządzeń lub ogranicza ją dla tej strony w tym kontekście.",
    );
  }

  async function querySpeakerSelectionPermission() {
    return queryMediaPermission("speaker-selection");
  }

  async function queryMediaPermission(name) {
    if (
      typeof navigator === "undefined" ||
      !navigator.permissions ||
      typeof navigator.permissions.query !== "function"
    ) {
      return null;
    }
    try {
      const status = await navigator.permissions.query({ name });
      return typeof status?.state === "string" ? status.state : null;
    } catch (_error) {
      return null;
    }
  }

  function normalizeSinkId(sinkId) {
    return typeof sinkId === "string" && sinkId.trim() ? sinkId : "default";
  }

  function getCurrentSinkId() {
    return normalizeSinkId(audio.sinkId);
  }

  function getStoredSinkId() {
    try {
      return normalizeSinkId(window.localStorage.getItem(sinkIdStorageKey));
    } catch (_error) {
      return "default";
    }
  }

  function storeSinkId(sinkId) {
    try {
      window.localStorage.setItem(sinkIdStorageKey, normalizeSinkId(sinkId));
    } catch (_error) {
      // Ignore storage errors in private browsing or restricted contexts.
    }
  }

  function setOutputDeviceStatus(message) {
    if (!outputDeviceStatusNode) {
      return;
    }
    outputDeviceStatusNode.textContent = message;
  }

  function updateCurrentAudioOutputLabel() {
    if (!outputDeviceCurrentNode || !outputDeviceSelect) {
      return;
    }
    const selectedOption = outputDeviceSelect.selectedOptions[0];
    outputDeviceCurrentNode.textContent =
      selectedOption?.textContent || "Domyślne urządzenie systemowe";
  }

  function formatErrorMessage(error) {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return String(error);
  }
})();
