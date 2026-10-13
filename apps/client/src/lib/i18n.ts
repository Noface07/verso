import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur'];

export function isRtlLanguage(lang: string): boolean {
  return RTL_LANGUAGES.some((code) => lang.toLowerCase().startsWith(code));
}

export function updateDocumentDirection(lang: string): void {
  if (typeof document === 'undefined') return;
  const isRtl = isRtlLanguage(lang);
  document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
}

export const resources = {
  en: {
    translation: {
      common: {
        appName: 'Folio',
        cancel: 'Cancel',
        save: 'Save',
        delete: 'Delete',
        edit: 'Edit',
        close: 'Close',
        back: 'Back',
        done: 'Done',
        loading: 'Loading…',
        search: 'Search',
        refresh: 'Refresh',
        settings: 'Settings',
        apply: 'Apply',
        clear: 'Clear',
        yes: 'Yes',
        no: 'No',
      },
      nav: {
        home: 'Home',
        library: 'Library',
        notebook: 'Notebook',
        store: 'Store',
        stats: 'Statistics',
        settings: 'Settings',
        updates: 'Updates',
      },
      settings: {
        title: 'Settings',
        appearance: 'Appearance',
        reading: 'Reading',
        manga: 'Manga',
        library: 'Library',
        account: 'Account & Sync',
        storage: 'Storage',
        backup: 'Backup & Restore',
        about: 'About',
        theme: 'Theme',
        themeSystem: 'System',
        themeLight: 'Light',
        themeDark: 'Dark',
        accentColor: 'Accent Color',
        ambientBackdrop: 'Ambient Cover Backdrop',
        density: 'Interface Density',
        densityComfortable: 'Comfortable',
        densityCompact: 'Compact',
        language: 'App Language',
        fontSize: 'Font Size',
        fontFamily: 'Font Family',
        lineHeight: 'Line Height',
        volumeKeys: 'Volume Keys Turn Pages',
        haptics: 'Haptic Feedback',
        keepScreenOn: 'Keep Screen Awake While Reading',
        contentRating: 'MangaDex Content Ratings',
        safe: 'Safe',
        suggestive: 'Suggestive',
        erotica: 'Erotica (18+)',
        pornographic: 'Pornographic (18+)',
        dataSaver: 'Mobile Data Saver',
        defaultReadingMode: 'Default Reading Mode',
        rtl: 'Right-to-Left (Manga)',
        ltr: 'Left-to-Right',
        webtoon: 'Webtoon (Continuous)',
        clearMangaCache: 'Clear Manga Page Cache',
        clearCacheSuccess: 'Cache cleared successfully',
        exportBackup: 'Export Everything (.foliobackup)',
        restoreBackup: 'Restore from Backup',
        storageUsed: 'Storage Used',
        booksStorage: 'Books Storage',
        coversStorage: 'Covers Storage',
        mangaStorage: 'Manga Offline Cache',
        version: 'Version',
        licenses: 'Licenses & Attribution',
      },
      onboarding: {
        welcomeTitle: 'Welcome to Folio',
        welcomeSubtitle: 'Your personal, distraction-free reader for eBooks and Manga.',
        chooseTheme: 'Choose your preferred look',
        next: 'Continue',
        skip: 'Skip',
        addBooksTitle: 'Add your library',
        addBooksSubtitle: 'Drag and drop your EPUB, MOBI, PDF, or comic files here, or explore public-domain classics.',
        dropBooksHere: 'Drop book files here to import',
        browseFiles: 'Browse local files',
        exploreStore: 'Explore Book Store',
        syncTitle: 'Sync Everywhere',
        syncSubtitle: 'Keep your reading progress, annotations, and bookmarks seamlessly synced across desktop, mobile, and web.',
        signInNow: 'Sign in / Create Account',
        startReading: 'Start Reading',
      },
      backup: {
        exportSuccess: 'Backup exported successfully.',
        importSuccess: 'Backup imported successfully.',
        importError: 'Failed to restore backup.',
        invalidBackup: 'Invalid backup file format.',
      },
    },
  },
  ar: {
    translation: {
      common: {
        appName: 'فوليو',
        cancel: 'إلغاء',
        save: 'حفظ',
        delete: 'حذف',
        edit: 'تعديل',
        close: 'إغلاق',
        back: 'رجوع',
        done: 'تم',
        loading: 'جار التحميل…',
        search: 'بحث',
        refresh: 'تحديث',
        settings: 'الإعدادات',
      },
      nav: {
        home: 'الرئيسية',
        library: 'المكتبة',
        notebook: 'الملاحظات',
        store: 'المتجر',
        stats: 'الإحصائيات',
        settings: 'الإعدادات',
        updates: 'التحديثات',
      },
      settings: {
        title: 'الإعدادات',
        appearance: 'المظهر',
        reading: 'القراءة',
        manga: 'المانجا',
        library: 'المكتبة',
        account: 'الحساب والمزامنة',
        storage: 'التخزين',
        backup: 'النسخ الاحتياطي',
        about: 'حول التطبيق',
      },
    },
  },
};

void i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export async function setAppLanguage(lang: string): Promise<void> {
  await i18n.changeLanguage(lang);
  updateDocumentDirection(lang);
}

export const t = (key: string, options?: Record<string, unknown>): string => {
  return i18n.t(key, options);
};

export default i18n;
