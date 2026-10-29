import { useMemo, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { CHARACTER_SCENE_CATEGORIES, CHARACTER_SCENES, findCharacterScenes, type CharacterScene, type CharacterSceneCategory, type CharacterSceneId } from "@/src/character/character-scene-catalog";
import { CHARACTER_SCENE_PICTURE_ART } from "@/src/character/character-scene-art";
import { useUiText } from "@/src/i18n/use-ui-text";
import { looiTheme } from "@/src/ui/looi-theme";

export function CharacterSceneLibrary({ onSelect }: { onSelect: (id: CharacterSceneId) => void }) {
  const { t, language = "en" } = useUiText();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CharacterSceneCategory | undefined>();
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const found = useMemo(() => findCharacterScenes(query, category), [query, category]);
  const categories = Object.entries(CHARACTER_SCENE_CATEGORIES) as [CharacterSceneCategory, Record<typeof language, string>][];
  const renderItem = ({ item }: { item: CharacterScene }) => <View style={styles.cell}>
    <Pressable accessibilityRole="button" accessibilityLabel={item.label[language]}
      accessibilityHint={t("characterScene.selectHint")} onPress={() => onSelect(item.id)} style={styles.picture}>
      <Image source={CHARACTER_SCENE_PICTURE_ART[item.id]} contentFit="contain" accessible={false} style={styles.art} />
      <Text style={styles.label}>{item.label[language]}</Text>
      <Text style={styles.category}>{CHARACTER_SCENE_CATEGORIES[item.category][language]}</Text>
    </Pressable>
  </View>;
  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <Text style={styles.description}>{t("characterScene.description")}</Text>
    <TextInput value={query} onChangeText={setQuery} accessibilityLabel={t("characterScene.search")}
      placeholder={t("characterScene.search")} placeholderTextColor={looiTheme.muted} returnKeyType="search"
      autoCorrect={false} style={styles.search} clearButtonMode="while-editing" />
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: categoriesOpen }}
      accessibilityLabel={`${t("characterScene.category")}: ${category ? CHARACTER_SCENE_CATEGORIES[category][language] : t("characterScene.all")}`}
      onPress={() => setCategoriesOpen(value => !value)} style={styles.categoryControl}>
      <Text style={styles.filterText}>{category ? CHARACTER_SCENE_CATEGORIES[category][language] : t("characterScene.all")}</Text>
      <Text accessible={false} style={styles.filterText}>{categoriesOpen ? "−" : "+"}</Text>
    </Pressable>
    {categoriesOpen ? <View style={styles.categoryOptions}>
      <FlatList data={[[undefined, { [language]: t("characterScene.all") }], ...categories] as [CharacterSceneCategory | undefined, Record<typeof language, string>][]}
        keyExtractor={([id]) => id ?? "all"} keyboardShouldPersistTaps="handled"
        renderItem={({ item: [id, labels] }) => <Pressable accessibilityRole="radio" accessibilityState={{ selected: category === id }}
          onPress={() => { setCategory(id); setCategoriesOpen(false); }} style={styles.categoryOption}>
          <Text style={[styles.filterText, category === id && styles.selectedText]}>{labels[language]}</Text>
        </Pressable>} />
    </View> : null}
    <Text accessibilityLiveRegion="polite" style={styles.count}>{t("characterScene.count", { count: found.length, total: CHARACTER_SCENES.length })}</Text>
    <FlatList data={found} numColumns={2} keyExtractor={item => item.id} renderItem={renderItem}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" initialNumToRender={8} maxToRenderPerBatch={6} windowSize={5}
      contentContainerStyle={styles.list} ListEmptyComponent={<View style={styles.empty}>
        <Text style={styles.description}>{t("characterScene.empty")}</Text>
        <Pressable accessibilityRole="button" onPress={() => { setQuery(""); setCategory(undefined); }} style={styles.categoryControl}>
          <Text style={styles.filterText}>{t("characterScene.reset")}</Text>
        </Pressable>
      </View>} />
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  description: { color: looiTheme.muted, fontSize: 14, lineHeight: 21, marginBottom: 14 },
  search: { minHeight: 48, borderWidth: 1, borderColor: looiTheme.line, borderRadius: 12,
    backgroundColor: looiTheme.bg, color: looiTheme.text, fontSize: 16, paddingHorizontal: 14, paddingVertical: 10 },
  categoryControl: { minHeight: 44, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 4, gap: 12 },
  filterText: { color: looiTheme.text, fontSize: 15, flexShrink: 1 },
  selectedText: { color: looiTheme.cyan, fontWeight: "700" },
  categoryOptions: { maxHeight: 200, backgroundColor: looiTheme.bg, borderRadius: 12, marginBottom: 8 },
  categoryOption: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 12, justifyContent: "center" },
  count: { color: looiTheme.muted, fontSize: 13, marginBottom: 12 },
  list: { paddingBottom: 16 },
  cell: { width: "50%", padding: 5 },
  picture: { backgroundColor: looiTheme.whiteSoft, borderRadius: 14, padding: 12, minHeight: 185, flex: 1 },
  art: { width: "100%", aspectRatio: 360 / 320 },
  label: { color: looiTheme.text, fontSize: 15, fontWeight: "600", lineHeight: 21, marginTop: 6 },
  category: { color: looiTheme.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  empty: { paddingVertical: 24 },
});
