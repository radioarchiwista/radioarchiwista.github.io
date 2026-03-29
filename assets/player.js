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
  const stationCountNode = document.getElementById("player-station-count");
  const snapshotMetaNode = document.getElementById("player-snapshot-meta");
  const emptyStateNode = document.getElementById("player-empty-state");
  const loadedStateNode = document.getElementById("player-loaded-state");
  const seekStepSeconds = 15;
  const youtubeSeekStepSeconds = 10;
  const stationsEndpoint =
    pageRoot?.dataset.playerStationsEndpoint || "/player/api/stations";
  const catalogUrlTemplate =
    pageRoot?.dataset.playerCatalogUrlTemplate || "/player/api/stations/{slug}/catalog";

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
  let selectedArchive = null;
  const monthFormatter = new Intl.DateTimeFormat("pl-PL", {
    month: "long",
    timeZone: "UTC",
  });

  stationSelect.addEventListener("change", async () => {
    resetArchiveSelection();
    const slug = stationSelect.value;
    if (!slug) {
      setStatus("Wybierz stację, aby załadować katalog godzin.");
      return;
    }

    await loadStationCatalog(slug);
  });

  yearSelect.addEventListener("change", () => {
    populateMonthOptions();
    populateDayOptions();
    populateHourOptions();
  });

  monthSelect.addEventListener("change", () => {
    populateDayOptions();
    populateHourOptions();
  });

  daySelect.addEventListener("change", () => {
    populateHourOptions();
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
    try {
      const response = await fetch(buildCatalogUrl(slug));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      stationCatalog = await response.json();
    } catch (error) {
      stationCatalog = null;
      setStatus(`Nie udało się pobrać katalogu archiwum: ${error}`);
      clearSelect(yearSelect, "Wybierz rok", true);
      clearSelect(monthSelect, "Wybierz miesiąc", true);
      clearSelect(daySelect, "Wybierz dzień", true);
      clearSelect(hourSelect, "Wybierz godzinę", true);
      return;
    }

    populateYearOptions();
    populateMonthOptions();
    populateDayOptions();
    populateHourOptions();
    setStatus(
      `Załadowano ${stationCatalog.archives.length} godzin dla ${stationCatalog.station.display_name}.`,
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
      const stations = Array.isArray(payload.stations) ? payload.stations : [];
      populateStationOptions(stations);
      updateStationCount(stations.length);
      updateSnapshotMeta(
        payload.published_at || payload.generated_at || null,
        payload.latest_archive_hour_started_at || null,
      );
      if (stations.length === 0) {
        setStatus("Brak opublikowanych godzin do odsłuchu.");
      }
      return;
    } catch (error) {
      if (fallbackStationCount > 0) {
        updateSnapshotMeta(null, null);
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

  function populateYearOptions() {
    const years = uniqueValues(stationCatalog.archives.map((archive) => archive.year)).sort(
      (left, right) => right - left,
    );
    fillSelect(yearSelect, years, (year) => ({
      value: String(year),
      label: String(year),
    }));
  }

  function populateMonthOptions() {
    const selectedYear = Number(yearSelect.value);
    const months = uniqueValues(
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
  }

  function populateDayOptions() {
    const selectedMonth = Number(monthSelect.value);
    const days = uniqueValues(
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
  }

  function populateHourOptions() {
    const selectedDay = Number(daySelect.value);
    const archives = filteredArchives();
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
    selectedArchive = stationCatalog
      ? stationCatalog.archives.find((archive) => archive.hourly_archive_id === archiveId) || null
      : null;
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

  function updateSnapshotMeta(publishedAt, latestArchiveHourStartedAt) {
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
    if (parts.length === 0) {
      snapshotMetaNode.textContent = "Brak informacji o ostatniej publikacji archiwum.";
      return;
    }
    snapshotMetaNode.textContent = parts.join(" ");
  }

  function buildCatalogUrl(slug) {
    return catalogUrlTemplate.replace("{slug}", encodeURIComponent(slug));
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
    await loadStationIndex();
  }
})();
