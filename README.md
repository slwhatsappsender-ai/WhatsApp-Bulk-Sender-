# WA Bot Pro — Standalone Multi-Account WhatsApp Desktop Application (`D:\whatsapp bot`)

මෙම මෘදුකාංගය බාහිර සර්වරයක (External Server) හෝ පරිගණකයේ වෙනම ස්ථාපනය කර ඇති වෙනත් මෘදුකාංගයක (Node.js / Chrome Browser) සහායකින් තොරව **100%ක්ම ඔබගේ පරිගණකය තුළ ස්වාධීනව (Self-Contained Desktop App)** ක්‍රියාත්මක වන ලෙස `D:\whatsapp bot` තුළ සකසා ඇත.

---

## 🚀 මෘදුකාංගය විවෘත කරන ආකාරය (How to Launch)

1. `D:\whatsapp bot` ෆෝල්ඩරය තුළ ඇති **`WA-Bot-Pro.exe`** (හෝ `Start-WhatsApp-Bot-Desktop.bat`) මත Double-Click කරන්න.
2. මෘදුකාංගයට අවශ්‍ය සියලුම Runtime ගොනු (`node_modules\electron\dist\electron.exe`, `@whiskeysockets/baileys`, `xlsx`, Local Database `data\`) මෘදුකාංගය ඇතුළතම අන්තර්ගත කර ඇත.

---

## ✨ ඇතුළත් කර ඇති සියලුම පහසුකම් (Features Included)

1. **WhatsApp Account් 5ක් දක්වා සම්බන්ධ කිරීම (`bot1` .. `bot5`)**:
   - QR කේතය (QR Code) Scan කිරීම මගින් WhatsApp Account් 5ක් දක්වා එකවර සම්බන්ධ කළ හැක.
   - එක් එක් ගිණුමේ **Connected / Disconnected / QR Ready** තත්වය සජීවීව පෙන්වන අතර ඕනෑම වේලාවක **Disconnect** කළ හැක.

2. **දෛනික පණිවිඩ සීමාව (Daily Limit) සහ ස්වයංක්‍රීය ගිණුම් මාරුව (Auto-Failover)**:
   - එක් එක් ගිණුමෙන් දිනකට යැවිය හැකි පණිවිඩ ගණන වෙන වෙනම හෝ එකවර සීමා කළ හැක.
   - පළමු ගිණුමේ දෛනික සීමාව අවසන් වූ වහාම ස්වයංක්‍රීයව ඊළඟ සම්බන්ධිත ගිණුමෙන් පණිවිඩ යැවීම සිදු කරයි.
   - සම්බන්ධ කර ඇති සියලුම ගිණුම්වල දෛනික සීමාව අවසන් වූ විට පණිවිඩ යැවීම ස්වයංක්‍රීයව නතර වේ (`stopped_limit`).

3. **දුරකථන අංක ඇතුළත් කිරීමේ ක්‍රම 3ක් (Type, Excel, JSON)**:
   - **Type කර**: කෙලින්ම දුරකථන අංක සහ නම් ටයිප් කර ඇතුළත් කිරීම.
   - **Excel (`.xlsx`, `.xls`, `.csv`) මගින්**: Excel ගොනු Upload කර ස්වයංක්‍රීයව දුරකථන අංක සහ අනෙකුත් දත්ත තීරු (`name`, `course`, `amount` ආදිය) හඳුනා ගැනීම.
   - **JSON (`.json`) මගින්**: JSON ගොනු හෝ JSON දත්ත මගින් ඇතුළත් කිරීම.

4. **Message Templates සැකසීම, Save කිරීම සහ Excel/JSON දත්ත ආදේශනය**:
   - `hi :"name "` හෝ `{{name}}` හෝ `{course}` යන ඕනෑම ආකෘතියකින් Template සකසා Save කළ හැක.
   - Excel සහ JSON ගොනුවල ඇති තීරු (Columns) ස්වයංක්‍රීයව හඳුනාගෙන එක් එක් පුද්ගලයාට අදාළ දත්ත සහිතව පණිවිඩය සකස් වේ.

5. **Media අමුණුම් (`.image`, `video`, `pdf`, `contact` vCard) සහ Server ACK තහවුරු කිරීම**:
   - පණිවිඩයට අමතරව Image, Video, PDF Document සහ Contact Card (vCard) යැවිය හැක.
   - පණිවිඩය WhatsApp Server වෙත ගිය බව (`Server ACK`) තහවුරු කරගැනීමෙන් පසුව පමණක් ඊළඟ පණිවිඩය යවයි.

6. **කාල පරතරය සැකසීම (අවම තත්පර 3 පරතරය)**:
   - **අහඹු (Random Seconds)** හෝ **ස්ථිර (Fixed Seconds)** කාල පරතරයක් ලබා දිය හැකි අතර අවම තත්පර 3ක (`>= 3s`) පරතරයක් අනිවාර්යයෙන්ම පවත්වා ගනී.

7. **සම්පූර්ණ වන සහ ගැටළු ඇතිවන ප්‍රතිශතය (Completion % & Error %) සහ Report Download**:
   - Dashboard හි Circular Donut Charts මගින් සම්පූර්ණ වන ප්‍රතිශතය (`%`) සහ ගැටළු ඇතිවන ප්‍රතිශතය (`%`) සජීවීව පෙන්වයි.
   - සම්පූර්ණ වාර්තාව **Excel (`.xlsx`)**, **CSV (`.csv`)**, **JSON (`.json`)**, සහ **HTML** ආකාරයෙන් Download කළ හැක.

