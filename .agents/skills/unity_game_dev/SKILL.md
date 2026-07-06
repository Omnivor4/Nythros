---
name: unity_game_dev
description: Instruksi khusus untuk mengembangkan game di Unity menggunakan C#.
---

# Unity Game Dev Skill

Ketika user meminta untuk menulis script Unity (C#) atau memperbaiki bug di dalam game Unity, kamu HARUS mematuhi aturan berikut:

1. **Gunakan MonoBehaviour Best Practices:** 
   Hindari penggunaan `Update()` jika tidak perlu, gunakan event-driven architecture (seperti `Action` atau UnityEvents) sebisa mungkin.
2. **Hindari GetComponent di Update:** 
   Cache komponen di dalam `Awake()` atau `Start()`. Jangan pernah memanggil `GetComponent<T>()` di dalam loop `Update()`.
3. **Pemisahan Logika:** 
   Gunakan pola arsitektur yang bersih (misal: ScriptableObjects untuk data, Managers untuk state).
4. **Gunakan Header dan Tooltip:** 
   Selalu hiasi variabel public/serialized dengan `[Header("...")]` dan `[Tooltip("...")]` agar inspector terlihat rapi.
5. **Ganti Magic Numbers:** 
   Selalu buat variabel konstan atau SerializedField untuk angka-angka (seperti speed, force, durasi) dan hindari angka hard-coded.

Jika kamu harus memodifikasi C# script, selalu pikirkan performa dan memory allocation (hindari `new` di dalam frame updates).
