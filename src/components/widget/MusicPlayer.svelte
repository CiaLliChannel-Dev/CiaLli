<script lang="ts">
  import Icon from "@iconify/svelte";
  import { onDestroy, onMount, tick } from "svelte";
  import { slide } from "svelte/transition";
  // 导入国际化相关的 Key 和 i18n 实例
  import Key from "../../i18n/i18nKey";
  import { i18n } from "../../i18n/translation";
  import type { MusicPlayerConfig } from "../../types/config";
  import type { JsonObject, JsonValue } from "../../types/json";
  import {
    getJsonNumber,
    getJsonString,
    isJsonObject,
  } from "../../utils/json-utils";

  export let musicPlayer: MusicPlayerConfig = {
    enable: false,
    meting_api:
      "https://www.bilibili.uno/api?server=:server&type=:type&id=:id&auth=:auth&r=:r",
    id: "",
    server: "netease",
    type: "playlist",
    marqueeSpeed: 40,
  };

  const musicPlayerConfig = musicPlayer;

  // Meting API 地址，从配置中获取或使用默认地址(bilibili.uno(由哔哩哔哩松坂有希公益管理)),服务器在海外,部分音乐平台可能不支持并且速度可能慢,也可以自建Meting API
  const meting_api =
    musicPlayerConfig.meting_api ??
    "https://www.bilibili.uno/api?server=:server&type=:type&id=:id&auth=:auth&r=:r";
  // Meting API 的 ID，从配置中获取或使用默认值
  const meting_id = musicPlayerConfig.id ?? "14164869977";
  // Meting API 的服务器，从配置中获取或使用默认值,有的meting的api源支持更多平台,一般来说,netease=网易云音乐, tencent=QQ音乐, kugou=酷狗音乐, xiami=虾米音乐, baidu=百度音乐
  const meting_server = musicPlayerConfig.server ?? "netease";
  // Meting API 的类型，从配置中获取或使用默认值
  const meting_type = musicPlayerConfig.type ?? "playlist";

  // 播放状态，默认为 false (未播放)
  let isPlaying = false;
  // 播放器是否展开，默认为 false
  let isExpanded = false;
  // 播放器是否隐藏，默认为 false
  let isHidden = false;
  // 是否显示播放列表，默认为 false
  let showPlaylist = false;
  // 当前播放时间，默认为 0
  let currentTime = 0;
  // 歌曲总时长，默认为 0
  let duration = 0;
  // localStorage 存储音量
  const STORAGE_KEY_VOLUME = "music-player-volume";
  // 音量，默认为 0.7
  let volume = 0.7;
  // 是否静音，默认为 false
  let isMuted = false;
  // 是否正在加载，默认为 false
  let isLoading = false;
  // 是否随机播放，默认为 false
  let isShuffled = false;
  // 循环模式，0: 不循环, 1: 单曲循环, 2: 列表循环，默认为 0
  let isRepeating = 0;
  // 播放器显示模式不做本地存储
  type PlayerDisplayMode = "mini" | "expanded" | "orb";
  // 播放歌曲状态存储键
  const playbackStateStorageKey = "music-player:playback-state";
  type PlaybackState = {
    index?: number;
    songId?: number | string;
    time?: number;
  };
  // 错误信息，默认为空字符串
  let errorMessage = "";
  // 是否显示错误信息，默认为 false
  let showError = false;

  // 当前歌曲信息
  let currentSong = {
    title: "Sample Song",
    artist: "Sample Artist",
    cover: "/favicon/favicon.ico",
    url: "",
    duration: 0,
  };

  type Song = {
    id: number | string;
    title: string;
    artist: string;
    cover: string;
    url: string;
    duration: number;
  };

  let playlist: Song[] = [];
  let currentIndex = 0;
  let audio: HTMLAudioElement;
  let progressBar: HTMLElement;
  let volumeBar: HTMLElement;
  let miniTitleWrap: HTMLDivElement | null = null;
  let expandedTitleWrap: HTMLDivElement | null = null;
  let miniTitleMarquee = false;
  let expandedTitleMarquee = false;
  let marqueeRaf: number | null = null;
  let miniMarqueeDelay = false;
  let expandedMarqueeDelay = false;
  let miniDelayTimer: number | null = null;
  let expandedDelayTimer: number | null = null;
  const marqueeGap = 24;
  const marqueePauseMs = 4000;
  const marqueeSpeed = Math.max(10, musicPlayerConfig.marqueeSpeed ?? 40);

  function parseMetingSong(value: JsonValue): Song {
    const object: JsonObject = isJsonObject(value) ? value : {};

    const title =
      getJsonString(object, "name") ??
      getJsonString(object, "title") ??
      i18n(Key.unknownSong);
    const artist =
      getJsonString(object, "artist") ??
      getJsonString(object, "author") ??
      i18n(Key.unknownArtist);

    const rawId = object.id;
    const id =
      typeof rawId === "number" || typeof rawId === "string" ? rawId : "";

    let dur = getJsonNumber(object, "duration") ?? 0;
    if (dur > 10000) dur = Math.floor(dur / 1000);
    if (!Number.isFinite(dur) || dur <= 0) dur = 0;

    return {
      id,
      title,
      artist,
      cover: getJsonString(object, "pic") ?? "",
      url: getJsonString(object, "url") ?? "",
      duration: dur,
    };
  }

  function loadVolumeSettings() {
    try {
      if (typeof localStorage === "undefined") return;
      const savedVolume = localStorage.getItem(STORAGE_KEY_VOLUME);
      if (savedVolume !== null && !Number.isNaN(Number(savedVolume))) {
        volume = Number(savedVolume);
      }
    } catch (error) {
      console.warn("音乐播放器音量设置读取失败:", error);
    }
  }

  function saveVolumeSettings() {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(STORAGE_KEY_VOLUME, volume.toString());
    } catch (error) {
      console.warn("音乐播放器音量设置保存失败:", error);
    }
  }

  async function fetchMetingPlaylist() {
    if (!meting_api || !meting_id) return;
    isLoading = true;
    const apiUrl = meting_api
      .replace(":server", meting_server)
      .replace(":type", meting_type)
      .replace(":id", meting_id)
      .replace(":auth", "")
      .replace(":r", Date.now().toString());
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error("meting api error");
      const list = (await res.json()) as JsonValue;
      playlist = Array.isArray(list) ? list.map(parseMetingSong) : [];
      if (playlist.length > 0) {
        const restored = applyPlaybackState();
        if (!restored) {
          loadSong(playlist[0]);
        }
      }
      isLoading = false;
    } catch {
      showErrorMessage(i18n(Key.musicPlayerErrorPlaylist));
      isLoading = false;
    }
  }

  function togglePlay() {
    if (!audio || !currentSong.url) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  }

  function toggleExpanded() {
    isExpanded = !isExpanded;
    showPlaylist = false;
    if (isExpanded) {
      isHidden = false;
    }
    persistDisplayMode();
  }

  function toggleHidden() {
    isHidden = !isHidden;
    if (isHidden) {
      isExpanded = false;
      showPlaylist = false;
    }
    persistDisplayMode();
  }

  function handleOrbClick() {
    toggleHidden();
  }

  function handleCollapseToOrb() {
    toggleExpanded();
  }

  function togglePlaylist() {
    showPlaylist = !showPlaylist;
  }

  function applyDisplayMode(mode: PlayerDisplayMode): void {
    if (mode === "expanded") {
      isExpanded = true;
      isHidden = false;
      showPlaylist = false;
      return;
    }
    if (mode === "orb") {
      isHidden = true;
      isExpanded = false;
      showPlaylist = false;
      return;
    }
    isExpanded = false;
    isHidden = false;
    showPlaylist = false;
  }

  function persistDisplayMode(): void {}

  function readDisplayMode(): PlayerDisplayMode | null {
    return null;
  }

  let pendingRestoreTime: number | null = null;
  let persistTimer: number | null = null;

  function persistPlaybackState(): void {
    try {
      if (typeof localStorage === "undefined") return;
      const state: PlaybackState = {
        index: currentIndex,
        songId: playlist[currentIndex]?.id,
        time: currentTime,
      };
      localStorage.setItem(playbackStateStorageKey, JSON.stringify(state));
    } catch (error) {
      console.warn("音乐播放器播放状态持久化失败:", error);
    }
  }

  function schedulePlaybackPersist(): void {
    if (persistTimer !== null) return;
    persistTimer = window.setTimeout(() => {
      persistPlaybackState();
      persistTimer = null;
    }, 1000);
  }

  function readPlaybackState(): PlaybackState | null {
    try {
      if (typeof localStorage === "undefined") return null;
      const stored = localStorage.getItem(playbackStateStorageKey);
      if (!stored) return null;
      const parsed = JSON.parse(stored) as PlaybackState;
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch (error) {
      console.warn("音乐播放器播放状态读取失败:", error);
    }
    return null;
  }

  function applyPlaybackState(): boolean {
    const stored = readPlaybackState();
    if (!stored || playlist.length === 0) return false;
    let targetIndex = -1;
    if (stored.songId !== undefined) {
      targetIndex = playlist.findIndex(
        (song) => String(song.id) === String(stored.songId),
      );
    }
    if (targetIndex < 0 && typeof stored.index === "number") {
      targetIndex = Math.min(Math.max(stored.index, 0), playlist.length - 1);
    }
    if (targetIndex < 0) return false;
    currentIndex = targetIndex;
    willAutoPlay = false;
    loadSong(playlist[targetIndex]);
    if (typeof stored.time === "number" && stored.time > 0) {
      pendingRestoreTime = stored.time;
    }
    return true;
  }

  function toggleShuffle() {
    isShuffled = !isShuffled;
    if (isShuffled) {
      isRepeating = 0;
    }
  }

  function toggleRepeat() {
    isRepeating = (isRepeating + 1) % 3;
    if (isRepeating !== 0) {
      isShuffled = false;
    }
  }

  function previousSong() {
    if (playlist.length <= 1) return;
    const newIndex = currentIndex > 0 ? currentIndex - 1 : playlist.length - 1;
    playSong(newIndex, isPlaying);
  }

  function nextSong(autoPlay?: boolean) {
    if (playlist.length <= 1) return;

    const shouldPlay = autoPlay ?? isPlaying;

    let newIndex: number;
    if (isShuffled) {
      do {
        newIndex = Math.floor(Math.random() * playlist.length);
      } while (newIndex === currentIndex && playlist.length > 1);
    } else {
      newIndex = currentIndex < playlist.length - 1 ? currentIndex + 1 : 0;
    }
    playSong(newIndex, shouldPlay);
  }

  // 记录切歌时的播放意图，用于解决加载失败时的状态传递问题
  let willAutoPlay = false;

  function playSong(index: number, autoPlay = true) {
    if (index < 0 || index >= playlist.length) return;

    willAutoPlay = autoPlay;
    currentIndex = index;
    loadSong(playlist[currentIndex]);
    persistPlaybackState();
  }

  function getAssetPath(path: string): string {
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    if (path.startsWith("/")) return path;
    return `/${path}`;
  }

  function loadSong(song: typeof currentSong) {
    if (!song) return;
    if (song.url !== currentSong.url) {
      currentSong = { ...song };
      if (song.url) {
        isLoading = true;
      } else {
        isLoading = false;
      }
    }
  }

  // 标记是否因浏览器策略导致自动播放失败
  let autoplayFailed = false;

  function handleLoadSuccess() {
    isLoading = false;
    if (audio?.duration && audio.duration > 1) {
      duration = Math.floor(audio.duration);
      if (playlist[currentIndex]) playlist[currentIndex].duration = duration;
      currentSong.duration = duration;
    }

    if (pendingRestoreTime !== null && audio) {
      const clampedTime = audio.duration
        ? Math.min(pendingRestoreTime, audio.duration)
        : pendingRestoreTime;
      audio.currentTime = clampedTime;
      currentTime = clampedTime;
      pendingRestoreTime = null;
    }

    if (willAutoPlay || isPlaying) {
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((error) => {
          console.warn("自动播放被拦截，等待用户交互:", error);
          autoplayFailed = true;
          isPlaying = false;
        });
      }
    }
  }

  function handleUserInteraction() {
    if (autoplayFailed && audio) {
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            autoplayFailed = false;
          })
          .catch(() => {});
      }
    }
  }

  function handleLoadError(_event: Event) {
    if (!currentSong.url) return;
    isLoading = false;
    showErrorMessage(i18n(Key.musicPlayerErrorSong));

    const shouldContinue = isPlaying || willAutoPlay;
    if (playlist.length > 1) {
      setTimeout(() => nextSong(shouldContinue), 1000);
    } else {
      showErrorMessage(i18n(Key.musicPlayerErrorEmpty));
    }
  }

  function handleLoadStart() {}

  function handleAudioEnded() {
    if (isRepeating === 1) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } else if (isRepeating === 2 || isShuffled) {
      nextSong(true);
    } else {
      isPlaying = false;
    }
    persistPlaybackState();
  }

  function showErrorMessage(message: string) {
    errorMessage = message;
    showError = true;
    setTimeout(() => {
      showError = false;
    }, 3000);
  }
  function hideError() {
    showError = false;
  }

  function setProgress(event: MouseEvent) {
    if (!audio || !progressBar) return;
    const rect = progressBar.getBoundingClientRect();
    const percent = (event.clientX - rect.left) / rect.width;
    const newTime = percent * duration;
    audio.currentTime = newTime;
    currentTime = newTime;
    persistPlaybackState();
  }

  let isVolumeDragging = false;
  let isPointerDown = false;
  let volumeBarRect: DOMRect | null = null;
  let rafId: number | null = null;

  function startVolumeDrag(event: PointerEvent) {
    if (!volumeBar) return;
    event.preventDefault();

    isPointerDown = true;
    volumeBar.setPointerCapture(event.pointerId);

    volumeBarRect = volumeBar.getBoundingClientRect();
    updateVolumeLogic(event.clientX);
  }

  function handleVolumeMove(event: PointerEvent) {
    if (!isPointerDown) return;
    event.preventDefault();

    isVolumeDragging = true;
    if (rafId) return;

    rafId = requestAnimationFrame(() => {
      updateVolumeLogic(event.clientX);
      rafId = null;
    });
  }

  function stopVolumeDrag(event: PointerEvent) {
    if (!isPointerDown) return;
    isPointerDown = false;
    isVolumeDragging = false;
    volumeBarRect = null;
    if (volumeBar) {
      volumeBar.releasePointerCapture(event.pointerId);
    }

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    saveVolumeSettings();
  }

  function updateVolumeLogic(clientX: number) {
    if (!audio || !volumeBar) return;

    const rect = volumeBarRect || volumeBar.getBoundingClientRect();
    const percent = Math.max(
      0,
      Math.min(1, (clientX - rect.left) / rect.width),
    );
    volume = percent;
  }

  function toggleMute() {
    isMuted = !isMuted;
  }

  function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  function updateTitleMarquee(
    element: HTMLDivElement | null,
    setActive: (value: boolean) => void,
  ): void {
    if (!element) return;
    const textElement = element.querySelector(
      ".title-marquee__text--main",
    ) as HTMLElement | null;
    const textWidth = textElement?.scrollWidth ?? 0;
    const clientWidth = element.clientWidth;
    const shouldMarquee = textWidth > clientWidth + 1;
    setActive(shouldMarquee);
    if (shouldMarquee) {
      const distance = Math.max(0, textWidth + marqueeGap);
      const duration = Math.min(Math.max(distance / marqueeSpeed, 8), 20);
      element.style.setProperty("--marquee-distance", `${distance}px`);
      element.style.setProperty("--marquee-duration", `${duration}s`);
      element.style.setProperty("--marquee-gap", `${marqueeGap}px`);
    } else {
      element.style.removeProperty("--marquee-distance");
      element.style.removeProperty("--marquee-duration");
      element.style.removeProperty("--marquee-gap");
    }
  }

  async function scheduleTitleMarqueeUpdate(): Promise<void> {
    if (typeof window === "undefined") return;
    await tick();
    if (marqueeRaf !== null) {
      cancelAnimationFrame(marqueeRaf);
    }
    marqueeRaf = window.requestAnimationFrame(() => {
      updateTitleMarquee(miniTitleWrap, (value) => {
        miniTitleMarquee = value;
      });
      updateTitleMarquee(expandedTitleWrap, (value) => {
        expandedTitleMarquee = value;
      });
      marqueeRaf = null;
    });
  }

  function clearMarqueeDelay(kind: "mini" | "expanded"): void {
    const timer = kind === "mini" ? miniDelayTimer : expandedDelayTimer;
    if (timer !== null) {
      clearTimeout(timer);
    }
    if (kind === "mini") {
      miniDelayTimer = null;
      miniMarqueeDelay = false;
    } else {
      expandedDelayTimer = null;
      expandedMarqueeDelay = false;
    }
  }

  function handleMarqueeIteration(kind: "mini" | "expanded"): void {
    if (!isPlaying || typeof window === "undefined") return;
    clearMarqueeDelay(kind);
    const shouldDelay =
      kind === "mini" ? miniTitleMarquee : expandedTitleMarquee;
    if (!shouldDelay) return;
    if (kind === "mini") {
      miniMarqueeDelay = true;
      miniDelayTimer = window.setTimeout(() => {
        miniMarqueeDelay = false;
        miniDelayTimer = null;
      }, marqueePauseMs);
    } else {
      expandedMarqueeDelay = true;
      expandedDelayTimer = window.setTimeout(() => {
        expandedMarqueeDelay = false;
        expandedDelayTimer = null;
      }, marqueePauseMs);
    }
  }

  $: if (musicPlayerConfig.enable) {
    void currentSong.title;
    void isExpanded;
    void isHidden;
    scheduleTitleMarqueeUpdate();
  }
  $: if (!isPlaying) {
    clearMarqueeDelay("mini");
    clearMarqueeDelay("expanded");
  }
  $: if (!miniTitleMarquee) {
    clearMarqueeDelay("mini");
  }
  $: if (!expandedTitleMarquee) {
    clearMarqueeDelay("expanded");
  }

  const interactionEvents = ["click", "keydown", "touchstart"];
  onMount(() => {
    loadVolumeSettings();
    interactionEvents.forEach((event) => {
      document.addEventListener(event, handleUserInteraction, {
        capture: true,
      });
    });

    if (!musicPlayerConfig.enable) {
      return;
    }
    const storedMode = readDisplayMode();
    if (storedMode) {
      applyDisplayMode(storedMode);
    }
    fetchMetingPlaylist();
  });

  onDestroy(() => {
    if (typeof document !== "undefined") {
      interactionEvents.forEach((event) => {
        document.removeEventListener(event, handleUserInteraction, {
          capture: true,
        });
      });
    }
    if (marqueeRaf !== null) {
      cancelAnimationFrame(marqueeRaf);
      marqueeRaf = null;
    }
    clearMarqueeDelay("mini");
    clearMarqueeDelay("expanded");
  });
</script>

<audio
  bind:this={audio}
  src={getAssetPath(currentSong.url)}
  bind:volume
  bind:muted={isMuted}
  on:play={() => {
    isPlaying = true;
  }}
  on:pause={() => {
    isPlaying = false;
  }}
  on:timeupdate={() => {
    currentTime = audio.currentTime;
    schedulePlaybackPersist();
  }}
  on:ended={handleAudioEnded}
  on:error={handleLoadError}
  on:loadeddata={handleLoadSuccess}
  on:loadstart={handleLoadStart}
  preload="auto"
></audio>

<svelte:window
  on:pointermove={handleVolumeMove}
  on:pointerup={stopVolumeDrag}
/>

{#if musicPlayerConfig.enable}
  {#if showError}
    <div class="fixed bottom-20 right-4 z-60 max-w-sm">
      <div
        class="bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 animate-slide-up"
      >
        <Icon icon="material-symbols:error" class="text-xl shrink-0" />
        <span class="text-sm flex-1">{errorMessage}</span>
        <button
          on:click={hideError}
          class="text-white/80 hover:text-white transition-colors"
          aria-label="关闭提示"
        >
          <Icon icon="material-symbols:close" class="text-lg" />
        </button>
      </div>
    </div>
  {/if}

  <div
    class="music-player fixed bottom-4 right-4 z-50 transition-all duration-300 ease-in-out"
    class:expanded={isExpanded}
    class:hidden-mode={isHidden}
  >
    <!-- 隐藏状态的小圆球 -->
    <div
      class="orb-player w-12 h-12 bg-(--primary) rounded-full shadow-2xl cursor-pointer transition-all duration-500 ease-in-out flex items-center justify-center hover:scale-110 active:scale-95"
      hidden={!isHidden}
      class:opacity-0={!isHidden}
      class:scale-0={!isHidden}
      class:pointer-events-none={!isHidden}
      on:click={handleOrbClick}
      on:keydown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleOrbClick();
        }
      }}
      role="button"
      tabindex="0"
      aria-label={i18n(Key.musicPlayerShow)}
    >
      {#if isLoading}
        <Icon icon="eos-icons:loading" class="text-white text-lg" />
      {:else if isPlaying}
        <div class="flex space-x-0.5">
          <div class="w-0.5 h-3 bg-white rounded-full animate-pulse"></div>
          <div
            class="w-0.5 h-4 bg-white rounded-full animate-pulse"
            style="animation-delay: 150ms;"
          ></div>
          <div
            class="w-0.5 h-2 bg-white rounded-full animate-pulse"
            style="animation-delay: 300ms;"
          ></div>
        </div>
      {:else}
        <Icon icon="material-symbols:music-note" class="text-white text-lg" />
      {/if}
    </div>
    <!-- 收缩状态的迷你播放器（封面圆形） -->
    <div
      class="mini-player card-base bg-(--float-panel-bg) shadow-2xl rounded-2xl p-3 transition-all duration-500 ease-in-out"
      hidden={isExpanded || isHidden}
      class:opacity-0={isExpanded || isHidden}
      class:scale-95={isExpanded || isHidden}
      class:pointer-events-none={isExpanded || isHidden}
    >
      <div class="flex items-center gap-3">
        <!-- 封面区域：点击控制播放/暂停 -->
        <div
          class="cover-container relative w-12 h-12 rounded-lg overflow-hidden cursor-pointer"
          on:click={togglePlay}
          on:keydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              togglePlay();
            }
          }}
          role="button"
          tabindex="0"
          aria-label={isPlaying
            ? i18n(Key.musicPlayerPause)
            : i18n(Key.musicPlayerPlay)}
        >
          <img
            src={getAssetPath(currentSong.cover)}
            alt={i18n(Key.musicPlayerCover)}
            class="w-full h-full object-cover transition-transform duration-300"
            class:animate-pulse={isLoading}
          />
          <div
            class="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
          >
            {#if isLoading}
              <Icon icon="eos-icons:loading" class="text-white text-xl" />
            {:else if isPlaying}
              <Icon icon="material-symbols:pause" class="text-white text-xl" />
            {:else}
              <Icon
                icon="material-symbols:play-arrow"
                class="text-white text-xl"
              />
            {/if}
          </div>
        </div>
        <!-- 歌曲信息区域：点击展开播放器 -->
        <div
          class="flex-1 min-w-0 cursor-pointer"
          on:click={toggleExpanded}
          on:keydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleExpanded();
            }
          }}
          role="button"
          tabindex="0"
          aria-label={i18n(Key.musicPlayerExpand)}
        >
          <div
            class="title-marquee text-sm font-medium text-90"
            bind:this={miniTitleWrap}
            class:marquee-active={miniTitleMarquee && isPlaying}
          >
            <div
              class="title-marquee__inner"
              class:marquee-delay={miniMarqueeDelay}
              on:animationiteration={() => handleMarqueeIteration("mini")}
            >
              <span class="title-marquee__text title-marquee__text--main"
                >{currentSong.title}</span
              >
              <span
                class="title-marquee__text title-marquee__clone"
                aria-hidden="true">{currentSong.title}</span
              >
            </div>
          </div>
          <div class="text-xs text-50 truncate">{currentSong.artist}</div>
        </div>
        <div class="flex items-center gap-1">
          <button
            class="btn-plain w-8 h-8 rounded-lg flex items-center justify-center"
            on:click|stopPropagation={toggleExpanded}
            aria-label={i18n(Key.musicPlayerExpand)}
          >
            <Icon icon="material-symbols:expand-less" class="text-lg" />
          </button>
        </div>
      </div>
    </div>
    <!-- 展开状态的完整播放器（封面圆形） -->
    <div
      class="expanded-player transition-all duration-500 ease-in-out"
      hidden={!isExpanded || isHidden}
      class:opacity-0={!isExpanded}
      class:scale-95={!isExpanded}
      class:pointer-events-none={!isExpanded}
    >
      {#if showPlaylist}
        <div
          class="playlist-panel absolute bottom-full left-0 mb-4 w-full max-h-96 overflow-hidden z-50"
          transition:slide={{ duration: 300, axis: "y" }}
        >
          <div
            class="playlist-header flex items-center justify-between p-4 border-b border-(--line-divider)"
          >
            <h3 class="text-lg font-semibold text-90">
              {i18n(Key.musicPlayerPlaylist)}
            </h3>
            <button
              class="btn-plain w-8 h-8 rounded-lg"
              on:click={togglePlaylist}
              aria-label="关闭播放列表"
            >
              <Icon icon="material-symbols:close" class="text-lg" />
            </button>
          </div>
          <div class="playlist-content overflow-y-auto max-h-80">
            {#each playlist as song, index (`${song.id}-${index}`)}
              <div
                class="playlist-item flex items-center gap-3 p-3 hover:bg-(--btn-plain-bg-hover) cursor-pointer transition-colors"
                class:bg-(--btn-plain-bg)={index === currentIndex}
                class:text-(--primary)={index === currentIndex}
                on:click={() => playSong(index)}
                on:keydown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    playSong(index);
                  }
                }}
                role="button"
                tabindex="0"
                aria-label="播放 {song.title} - {song.artist}"
              >
                <div class="w-6 h-6 flex items-center justify-center">
                  {#if index === currentIndex && isPlaying}
                    <Icon
                      icon="material-symbols:graphic-eq"
                      class="text-(--primary) animate-pulse"
                    />
                  {:else if index === currentIndex}
                    <Icon
                      icon="material-symbols:pause"
                      class="text-(--primary)"
                    />
                  {:else}
                    <span class="text-sm text-(--content-meta)"
                      >{index + 1}</span
                    >
                  {/if}
                </div>
                <div
                  class="w-10 h-10 rounded-lg overflow-hidden bg-(--btn-regular-bg) shrink-0"
                >
                  <img
                    src={getAssetPath(song.cover)}
                    alt={song.title}
                    loading="lazy"
                    class="w-full h-full object-cover"
                  />
                </div>
                <div class="flex-1 min-w-0">
                  <div
                    class="font-medium truncate"
                    class:text-(--primary)={index === currentIndex}
                    class:text-90={index !== currentIndex}
                  >
                    {song.title}
                  </div>
                  <div
                    class="text-sm text-(--content-meta) truncate"
                    class:text-(--primary)={index === currentIndex}
                  >
                    {song.artist}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <div class="card-base bg-(--float-panel-bg) shadow-2xl rounded-2xl p-4">
        <div class="flex items-center gap-4 mb-4">
          <div
            class="cover-container relative w-16 h-16 rounded-lg overflow-hidden shrink-0"
          >
            <img
              src={getAssetPath(currentSong.cover)}
              alt={i18n(Key.musicPlayerCover)}
              class="w-full h-full object-cover transition-transform duration-300"
              class:animate-pulse={isLoading}
            />
          </div>
          <div class="flex-1 min-w-0">
            <div
              class="song-title title-marquee text-lg font-bold text-90 mb-1"
              bind:this={expandedTitleWrap}
              class:marquee-active={expandedTitleMarquee && isPlaying}
            >
              <div
                class="title-marquee__inner"
                class:marquee-delay={expandedMarqueeDelay}
                on:animationiteration={() => handleMarqueeIteration("expanded")}
              >
                <span class="title-marquee__text title-marquee__text--main"
                  >{currentSong.title}</span
                >
                <span
                  class="title-marquee__text title-marquee__clone"
                  aria-hidden="true">{currentSong.title}</span
                >
              </div>
            </div>
            <div class="song-artist text-sm text-50 truncate">
              {currentSong.artist}
            </div>
            <div class="text-xs text-30 mt-1">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button
              class="btn-plain w-8 h-8 rounded-lg flex items-center justify-center"
              on:click={handleCollapseToOrb}
              title={i18n(Key.musicPlayerCollapse)}
            >
              <Icon icon="material-symbols:expand-more" class="text-lg" />
            </button>
          </div>
        </div>
        <div class="progress-section mb-4">
          <div
            class="progress-bar flex-1 h-2 bg-(--btn-regular-bg) rounded-full cursor-pointer"
            bind:this={progressBar}
            on:click={setProgress}
            on:keydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                const percent = 0.5;
                const newTime = percent * duration;
                if (audio) {
                  audio.currentTime = newTime;
                  currentTime = newTime;
                }
              }
            }}
            role="slider"
            tabindex="0"
            aria-label={i18n(Key.musicPlayerProgress)}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={duration > 0 ? (currentTime / duration) * 100 : 0}
          >
            <div
              class="h-full bg-(--primary) rounded-full transition-all duration-100"
              style="width: {duration > 0
                ? (currentTime / duration) * 100
                : 0}%"
            ></div>
          </div>
        </div>
        <div class="controls flex items-center justify-center gap-2 mb-4">
          <button
            class="w-10 h-10 rounded-lg"
            class:btn-regular={isShuffled}
            class:btn-plain={!isShuffled}
            on:click={toggleShuffle}
            disabled={playlist.length <= 1}
            aria-label={i18n(Key.musicPlayerShuffle)}
          >
            <Icon icon="material-symbols:shuffle" class="text-lg" />
          </button>
          <button
            class="btn-plain w-10 h-10 rounded-lg"
            on:click={previousSong}
            disabled={playlist.length <= 1}
            aria-label={i18n(Key.musicPlayerPrevious)}
          >
            <Icon icon="material-symbols:skip-previous" class="text-xl" />
          </button>
          <button
            class="btn-regular w-12 h-12 rounded-full"
            class:opacity-50={isLoading}
            disabled={isLoading}
            on:click={togglePlay}
            aria-label={isPlaying
              ? i18n(Key.musicPlayerPause)
              : i18n(Key.musicPlayerPlay)}
          >
            {#if isLoading}
              <Icon icon="eos-icons:loading" class="text-xl" />
            {:else if isPlaying}
              <Icon icon="material-symbols:pause" class="text-xl" />
            {:else}
              <Icon icon="material-symbols:play-arrow" class="text-xl" />
            {/if}
          </button>
          <button
            class="btn-plain w-10 h-10 rounded-lg"
            on:click={() => nextSong()}
            disabled={playlist.length <= 1}
            aria-label={i18n(Key.musicPlayerNext)}
          >
            <Icon icon="material-symbols:skip-next" class="text-xl" />
          </button>
          <button
            class="w-10 h-10 rounded-lg"
            class:btn-regular={isRepeating > 0}
            class:btn-plain={isRepeating === 0}
            on:click={toggleRepeat}
            aria-label={isRepeating === 1
              ? i18n(Key.musicPlayerRepeatOne)
              : i18n(Key.musicPlayerRepeat)}
          >
            {#if isRepeating === 1}
              <Icon icon="material-symbols:repeat-one" class="text-lg" />
            {:else if isRepeating === 2}
              <Icon icon="material-symbols:repeat" class="text-lg" />
            {:else}
              <Icon icon="material-symbols:repeat" class="text-lg opacity-50" />
            {/if}
          </button>
        </div>
        <div class="bottom-controls flex items-center gap-2">
          <button
            class="btn-plain w-8 h-8 rounded-lg"
            on:click={toggleMute}
            aria-label={i18n(Key.musicPlayerVolume)}
          >
            {#if isMuted || volume === 0}
              <Icon icon="material-symbols:volume-off" class="text-lg" />
            {:else if volume < 0.5}
              <Icon icon="material-symbols:volume-down" class="text-lg" />
            {:else}
              <Icon icon="material-symbols:volume-up" class="text-lg" />
            {/if}
          </button>
          <div
            class="flex-1 h-2 bg-(--btn-regular-bg) rounded-full cursor-pointer touch-none"
            bind:this={volumeBar}
            on:pointerdown={startVolumeDrag}
            on:keydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (e.key === "Enter") toggleMute();
              }
            }}
            role="slider"
            tabindex="0"
            aria-label={i18n(Key.musicPlayerVolume)}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={volume * 100}
          >
            <div
              class="h-full bg-(--primary) rounded-full transition-all"
              class:duration-100={!isVolumeDragging}
              class:duration-0={isVolumeDragging}
              style="width: {volume * 100}%"
            ></div>
          </div>
          <button
            class="btn-plain w-8 h-8 rounded-lg flex items-center justify-center"
            class:text-(--primary)={showPlaylist}
            on:click={togglePlaylist}
            title={i18n(Key.musicPlayerPlaylist)}
            aria-label={i18n(Key.musicPlayerPlaylist)}
          >
            <Icon icon="material-symbols:queue-music" class="text-lg" />
          </button>
        </div>
      </div>
    </div>
  </div>

  <style>
    .orb-player {
      position: relative;
    }
    .orb-player::before {
      content: "";
      position: absolute;
      inset: -0.125rem;
      background: linear-gradient(
        45deg,
        var(--primary),
        transparent,
        var(--primary)
      );
      border-radius: 50%;
      z-index: -1;
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    .orb-player:hover::before {
      opacity: 0.3;
      animation: rotate 2s linear infinite;
    }
    .orb-player .animate-pulse {
      animation: musicWave 1.5s ease-in-out infinite;
    }
    @keyframes rotate {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }
    @keyframes musicWave {
      0%,
      100% {
        transform: scaleY(0.5);
      }
      50% {
        transform: scaleY(1);
      }
    }
    .music-player.hidden-mode {
      width: 3rem;
      height: 3rem;
    }
    .music-player {
      max-width: 20rem;
      user-select: none;
    }
    .title-marquee {
      position: relative;
      overflow: hidden;
    }
    .title-marquee__inner {
      display: inline-flex;
      gap: var(--marquee-gap, 24px);
      min-width: 100%;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      transform: translateX(0);
    }
    .title-marquee__text {
      display: inline-block;
      white-space: nowrap;
    }
    .title-marquee__clone {
      display: none;
    }
    .title-marquee.marquee-active {
      text-overflow: clip;
    }
    .title-marquee.marquee-active .title-marquee__clone {
      display: inline-block;
    }
    .title-marquee.marquee-active .title-marquee__inner {
      overflow: visible;
      text-overflow: clip;
      animation: title-marquee var(--marquee-duration, 10s) linear infinite;
      will-change: transform;
    }
    .title-marquee__inner.marquee-delay {
      animation: none !important;
      transform: translateX(0);
    }
    .title-marquee.marquee-active:hover .title-marquee__inner {
      animation-play-state: paused;
    }
    @keyframes title-marquee {
      from {
        transform: translateX(0);
      }
      to {
        transform: translateX(calc(-1 * var(--marquee-distance, 0px)));
      }
    }
    .mini-player {
      width: 17.5rem;
      position: absolute;
      bottom: 0;
      right: 0;
      /*left: 0;*/
    }
    .expanded-player {
      width: 20rem;
      position: absolute;
      bottom: 0;
      right: 0;
    }

    .playlist-panel {
      background-color: var(--float-panel-bg);
      border-radius: var(--radius-large);
      transition: background-color 0.15s ease;
      box-shadow:
        0 -10px 15px -3px rgb(0 0 0 / 0.1),
        0 -4px 6px -2px rgb(0 0 0 / 0.05);
    }

    /* 自定义滚动条样式 */
    .playlist-content::-webkit-scrollbar {
      width: 6px;
    }
    .playlist-content::-webkit-scrollbar-track {
      background: transparent;
    }
    .playlist-content::-webkit-scrollbar-thumb {
      background-color: rgba(0, 0, 0, 0.1);
      border-radius: 3px;
    }
    :global(.dark) .playlist-content::-webkit-scrollbar-thumb {
      background-color: rgba(255, 255, 255, 0.1);
    }
    .playlist-content::-webkit-scrollbar-thumb:hover {
      background-color: rgba(0, 0, 0, 0.2);
    }
    :global(.dark) .playlist-content::-webkit-scrollbar-thumb:hover {
      background-color: rgba(255, 255, 255, 0.2);
    }

    .animate-pulse {
      animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
    @keyframes pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.5;
      }
    }
    .progress-section div:hover,
    .bottom-controls > div:hover {
      transform: scaleY(1.2);
      transition: transform 0.2s ease;
    }

    @keyframes slide-up {
      from {
        transform: translateY(100%);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }
    .animate-slide-up {
      animation: slide-up 0.3s ease-out;
    }
    @media (hover: none) and (pointer: coarse) {
      .music-player button,
      .playlist-item {
        min-height: 44px;
      }
      .progress-section > div,
      .bottom-controls > div:nth-child(2) {
        height: 12px;
      }
    }

    /* 让主题色按钮更有视觉反馈 */
    button.bg-\[var\(--primary\)\] {
      box-shadow: 0 0 0 2px var(--primary);
      border: none;
    }
  </style>
{/if}
