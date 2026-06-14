package com.example.tautracker.domain.usecase

import com.example.tautracker.data.remote.MoodleGradeTableData

data class CalculatedGrade(
    val assignmentName: String,
    val gradeValue: Double?,
    val maxGrade: Double?,
    val percentage: Double?,
    val isHidden: Boolean
)

class CalculateGradesUseCase {

    fun execute(tableData: List<MoodleGradeTableData>): List<CalculatedGrade> {
        val grades = mutableListOf<CalculatedGrade>()

        for (row in tableData) {
            val name = row.itemname?.content ?: continue
            // Skip course total rows and empty categories
            if (name.contains("Course total") || name.isBlank()) continue

            val gradeStr = row.grade?.content?.trim()
            val rangeStr = row.range?.content?.trim()

            var gNum: Double? = null
            var gmNum: Double? = null

            if (!gradeStr.isNullOrEmpty() && gradeStr != "-") {
                gNum = gradeStr.toDoubleOrNull()
            }

            if (!rangeStr.isNullOrEmpty() && rangeStr.contains("-")) {
                val maxStr = rangeStr.split("-").lastOrNull()?.trim()
                gmNum = maxStr?.toDoubleOrNull()
            } else if (!rangeStr.isNullOrEmpty()) {
                gmNum = rangeStr.toDoubleOrNull()
            } else {
                gmNum = 100.0
            }

            var percentage: Double? = null
            if (gNum != null && gmNum != null && gmNum > 0) {
                percentage = (gNum / gmNum) * 100.0
            }

            val isHidden = gradeStr == "Hidden" || gradeStr == "-"

            grades.add(
                CalculatedGrade(
                    assignmentName = name.replace(Regex("<[^>]*>"), ""), // Strip HTML
                    gradeValue = gNum,
                    maxGrade = gmNum,
                    percentage = percentage,
                    isHidden = isHidden
                )
            )
        }

        return grades
    }
}
