"""Emotion identity and prompts recovered from actual generated cloud archives."""
EMOTIONS = {
    'neutral': '正常', 'happy': '开心', 'sad': '伤心', 'angry': '生气',
    'nervous': '紧张', 'serious': '严肃', 'fearful': '恐惧', 'surprised': '惊讶',
    'disgusted': '厌恶', 'shy': '害羞', 'tired': '疲倦', 'curious': '好奇',
    'confident': '自信', 'affectionate': '撒娇',
}
EMOTION_IDS = {emotion: f'cloud_emotion_{emotion}' for emotion in EMOTIONS}
