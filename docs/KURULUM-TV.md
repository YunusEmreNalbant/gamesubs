# Samsung TV kurulum ve hata ayıklama rehberi

Bu adımlar Samsung **UE55M80HAUXTK** (Tizen platform 10.0) üzerinde, Tizen Studio 6.1 CLI ve Apple Silicon Mac ile uygulanıp doğrulandı. Başka Samsung modellerinde menü adları farklı olabilir. `<TV_IP>`, `<MAC_IP>` yerine kendi adreslerini yaz.

## 1. Mac araçları
1. Tizen Studio **CLI** yükleyicisini resmî sitesinden indir: `download.tizen.org/sdk/Installer/tizen-studio_6.1/web-cli_Tizen_Studio_6.1_macos-64.bin` (~280 MB). Lisansı okuyup kabul ederek kur:
   ```bash
   chmod +x web-cli_Tizen_Studio_6.1_macos-64.bin
   ./web-cli_Tizen_Studio_6.1_macos-64.bin --accept-license ~/tizen-studio
   ```
2. Paketleri ekle (Apple Silicon'da Rosetta ile çalıştığı doğrulandı):
   ```bash
   ~/tizen-studio/package-manager/package-manager-cli.bin install --accept-license \
     TV-SAMSUNG-Public TV-SAMSUNG-Public-WebAppDevelopment TV-SAMSUNG-Extension-Tools Certificate-Manager cert-add-on
   ```
3. Her yeni terminalde (ya da `~/.zshrc`'ye):
   ```bash
   export PATH="$HOME/tizen-studio/tools:$HOME/tizen-studio/tools/ide/bin:$PATH"
   ```

## 2. TV'de Geliştirici Modu
1. TV ve Mac aynı ağda. TV IP'si: Ayarlar → Genel → Ağ → Ağ Durumu.
2. Apps ekranında kumandayla **1 2 3 4 5** → Developer Mode **On**, **Host PC IP = Mac'in IP'si**, TV'yi yeniden başlat.
   - TV yalnızca bu IP'den gelen `sdb` bağlantısını kabul eder. **Mac'in IP'si değişirse burayı da güncelle.**
3. `sdb connect <TV_IP>` → `sdb devices` (model adı listelenmeli) → `sdb -s <TV_IP>:26101 shell "0 getduid"` ile TV'nin **DUID**'sini oku.

## 3. Samsung sertifikası
Samsung TV'ye yalnızca, **o TV'nin DUID'sini içeren Samsung distributor sertifikasıyla** imzalı uygulama yüklenir. Varsayılan Tizen sertifikası işe yaramaz.
1. `open ~/tizen-studio/tools/certificate-manager/certificate-manager.app` (pencere açılmazsa: Dock/Cmd+Tab'te "eclipse" uygulamasına bak).
2. Üstteki **+** (Certificate Profile) → cihaz tipi **Samsung / TV** → yeni profil adı ver.
3. Author: yeni oluştur (ya da mevcut bir author sertifikasını seç). Distributor: **Samsung hesabınla giriş** (kendin yap), Privilege **Public**, DUID'yi ekle. Parolaları kimseyle paylaşma.
4. Sertifika dosyaları `~/SamsungCertificate/` altında oluşur. **Asla depoya koyma.**

## 4. Derle, imzala, yükle
```bash
GAMESUBS_WS_URL=ws://<MAC_IP>:8765 npm run build
rm -rf build/app && mkdir -p build && cp -R dist build/app && rm build/app/main.js.map
tizen package -t wgt -s <SERTIFIKA_PROFILI> -- build/app     # paket build/app/GameSubs.wgt olarak çıkar
mv build/app/GameSubs.wgt build/
tizen install -n build/GameSubs.wgt -t <TV_ADI>              # <TV_ADI>: sdb devices'taki model adı
```
- `tizen package -o <göreli yol>` göreli yolu Tizen'in kendi dizinine göre çözer; `-o` kullanma, çıktıyı `build/app/` içinden al.
- Uygulamayı açmak için TV'de Apps → GameSubs (en güvenilir). `tizen run -p GmSubs0001.GameSubs -t <TV_ADI>` bazen takılır; takılırsa Ctrl+C.

## 5. Hata ayıklama
- TV'de sol üstteki menünün altında tanılama bilgileri, menüden açılabilen log paneli; WebSocket durumu ve hatalar sağ üstte kısa bildirim olarak çıkar.
- `sdb` yanıt vermiyorsa (komutlar takılıyor): `sdb disconnect <TV_IP>; sdb kill-server; sdb start-server; sdb connect <TV_IP>`.
- `sdb connect` portu açık olduğu hâlde reddediyorsa: TV'deki **Host PC IP** Mac'in güncel IP'siyle aynı mı?
- Uygulama kaldırıldıysa yeniden yüklemek için 4. adım yeterli.

## 6. TV uygulamasını kullanma
Kumanda: ▲▼ seç, ◄► değiştir, Enter uygula.
1. PS5 açıkken **Kaynakları yeniden tara** → **Kaynak: HDMI n** (PS5'in girişi) → **Kaynağı uygula + TV penceresini göster (BEHIND)**. PS5 kapalıyken taranırsa HDMI girişi listede çıkmayabilir.
2. **Örnek altyazı** ile metni 10 sn göster; **Altyazı arka planı** (yok / yarı saydam / opak), **boyut** ve **alttan konum** ile Türkçe altyazıyı oyunun İngilizce altyazısının üstüne getir. Opak kutu İngilizceyi kapatır; OCR Mac'te Remote Play görüntüsünden okuduğu için etkilenmez. Ayarlar kalıcıdır.
3. **Paneli gizle**: oyun sırasında panel gizli kalsın (gizliyken TV çizim yapmaz). Herhangi bir tuş paneli geri getirir.

Mac tarafı için: [MAC-CEVIRI.md](MAC-CEVIRI.md). Sunucuya ulaşılamazsa TV uygulaması birkaç denemeden sonra örnek (sahte) altyazılara düşer ve bildirim gösterir.
