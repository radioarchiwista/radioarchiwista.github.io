(function () {
  const pageRoot = document.querySelector(".player-page");
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
  const hierarchicalCatalogEnabled =
    Boolean(stationIndexUrlTemplate) &&
    Boolean(yearIndexUrlTemplate) &&
    Boolean(monthIndexUrlTemplate) &&
    Boolean(dayCatalogUrlTemplate);

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
  let catalogVersionToken = "";
  const yearIndexCache = new Map();
  const monthIndexCache = new Map();
  const dayCatalogCache = new Map();
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

  stationSelect.addEventListener("change", async () => {
    resetArchiveSelection();
    const slug = stationSelect.value;
    if (!slug) {
      setStatus("Wybierz stację, aby załadować katalog godzin.");
      return;
    }

    await loadStationCatalog(slug);
  });

  yearSelect.addEventListener("change", async () => {
    await handleYearChange();
  });

  monthSelect.addEventListener("change", async () => {
    await handleMonthChange();
  });

  daySelect.addEventListener("change", async () => {
    await handleDayChange();
  });

  hourSelect.addEventListener("change", () => {
    syncSelectedArchive();
  });

  loadButton.addEventListener("click", () => {
    if (!selectedArchive) {
      setStatus("Wybierz konkretną godzinę przed załadowaniem nagrania.");
      return;
    }
    loadArchiveIntoPlayer(selectedArchive);
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
    setStatus("Nie udało się załadować pliku audio dla wybranej godziny.");
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

  async function loadStationCatalog(slug) {
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

    populateYearOptions({ preferCurrentDate: true });
    if (hierarchicalCatalogEnabled) {
      await handleYearChange({ preferCurrentDate: true });
    } else {
      populateMonthOptions({ preferCurrentDate: true });
      populateDayOptions({ preferCurrentDate: true });
      populateHourOptions();
    }
    const archiveCount = stationCatalog?.station?.archive_count ?? stationCatalog?.archives?.length ?? 0;
    setStatus(
      `Załadowano ${archiveCount} godzin dla ${stationCatalog.station.display_name}.`,
    );
  }

  async function loadStationIndex() {
    const fallbackStationCount = Math.max(stationSelect.options.length - 1, 0);
    updateStationCount(fallbackStationCount);
    try {
      const response = await fetch(stationsEndpoint);
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
        stations.length,
      );
      if (stations.length === 0) {
        setStatus("Brak opublikowanych godzin do odsłuchu.");
      }
      return;
    } catch (error) {
      if (fallbackStationCount > 0) {
        updateSnapshotMeta(null, null, [], fallbackStationCount);
        setStatus("Nie udało się odświeżyć listy stacji. Używam danych wstępnych.");
        return;
      }
      clearSelect(stationSelect, "Wybierz stację", true);
      setStatus(`Nie udało się pobrać listy stacji: ${error}`);
    }
  }

  function populateStationOptions(stations) {
    if (!Array.isArray(stations) || stations.length === 0) {
      clearSelect(stationSelect, "Wybierz stację", true);
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
    const archives = hierarchicalCatalogEnabled
      ? [...(currentDayCatalog?.archives || [])]
      : filteredArchives();
    if (!selectedDay || archives.length === 0) {
      clearSelect(hourSelect, "Wybierz godzinę", true);
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
    const archiveId = Number(hourSelect.value);
    const archives = hierarchicalCatalogEnabled
      ? currentDayCatalog?.archives || []
      : stationCatalog?.archives || [];
    selectedArchive = archives.find((archive) => archive.hourly_archive_id === archiveId) || null;
    loadButton.disabled = !selectedArchive;
    if (selectedArchive) {
      setStatus(
        `Wybrano ${selectedArchive.local_hour_label || formatHourLabel(selectedArchive.hour)} z dnia ${selectedArchive.local_date_label || formatDateLabel(selectedArchive)} dla ${stationCatalog.station.display_name}.`,
      );
    }
  }

  function loadArchiveIntoPlayer(archive) {
    selectedArchive = archive;
    audio.src = archive.audio_url;
    audio.load();
    audio.playbackRate = Number(rateSelect.value);
    setDownloadLinkState(archive.download_url, archive.remote_filename || null);
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
    setStatus(`Załadowano nagranie ${archive.local_hour_label || formatHourLabel(archive.hour)}.`);
  }

  function resetArchiveSelection() {
    stationCatalog = null;
    clearDependentCatalogState();
    selectedArchive = null;
    clearSelect(yearSelect, "Wybierz rok", true);
    clearSelect(monthSelect, "Wybierz miesiąc", true);
    clearSelect(daySelect, "Wybierz dzień", true);
    clearSelect(hourSelect, "Wybierz godzinę", true);
    loadButton.disabled = true;
    setDownloadLinkState(null, null);
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
      "Po załadowaniu zobaczysz tutaj datę i godzinę w lokalnym czasie stacji.";
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

  function fillSelect(select, values, toOption, options = {}) {
    const { autoSelectFirst = true } = options;
    const previousValue = select.value;
    clearSelect(select, select.options[0]?.textContent || "Wybierz", false);
    values.forEach((value) => {
      const optionData = toOption(value);
      const option = document.createElement("option");
      option.value = optionData.value;
      option.textContent = optionData.label;
      select.append(option);
    });
    const nextValue =
      values.some((value) => String(toOption(value).value) === previousValue)
        ? previousValue
        : autoSelectFirst
          ? select.options[1]?.value || ""
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
    });
    const parts = [];
    if (publishedAt) {
      const publishedDate = new Date(publishedAt);
      if (!Number.isNaN(publishedDate.getTime())) {
        parts.push(`Katalog opublikowano: ${formatter.format(publishedDate)}.`);
      }
    }
    if (latestArchiveHourStartedAt) {
      const latestArchiveDate = new Date(latestArchiveHourStartedAt);
      if (!Number.isNaN(latestArchiveDate.getTime())) {
        parts.push(`Najnowsza godzina w katalogu: ${formatter.format(latestArchiveDate)}.`);
      }
    }
    if (Array.isArray(latestArchiveHourStations) && latestArchiveHourStations.length > 0) {
      if (stationCount > 0 && latestArchiveHourStations.length >= stationCount) {
        parts.push("Tę godzinę mają już wszystkie stacje.");
      } else {
        parts.push(`Mają ją już: ${latestArchiveHourStations.join(", ")}.`);
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
      setStatus(`Pobieranie pliku ${filename} zostało rozpoczęte.`);
    } catch (error) {
      setStatus(`Nie udało się pobrać pliku: ${error}`);
    } finally {
      downloadLink.textContent = originalLabel;
      setDownloadLinkState(archive.download_url, filename);
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
    await loadStationIndex();
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
